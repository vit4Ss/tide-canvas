"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/components/shared/toast";
import { projectApi } from "@/lib/api";
import { isImageCanvasNodeType } from "@/lib/canvas-node-types";
import { CANVAS_SAVE_NOW_EVENT, type CanvasSaveRequestDetail } from "@/lib/canvas-save";
import {
  isTransientCanvasSaveCode,
  nextCanvasSaveFollowUp,
  reconcileCanvasSave,
  type CanvasSaveReconciliation,
} from "@/lib/canvas-save-reconcile";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useAuthStore } from "@/stores/use-auth-store";
import {
  acknowledgeCanvasRecoveryDraft,
  hasCanvasRecoveryDraft,
  stageCanvasRecoveryDraft,
  type CanvasRecoverySnapshot,
} from "../../infrastructure/persistence/canvas-recovery-draft";
import { serializeCanvasDocument } from "../../infrastructure/persistence/serialize-canvas-document";
import { sanitizeCanvasNodeForPersistence } from "../../infrastructure/persistence/sanitize-canvas-node";
import {
  captureCanvasError,
  captureCanvasEvent,
  captureCanvasWarning,
} from "../../infrastructure/telemetry/canvas-telemetry";

const AUTOSAVE_DELAY_MS = 3_000;
const MAX_RETRY_DELAY_MS = 30_000;

interface MutableValue<T> {
  current: T;
}

interface UseCanvasPersistenceOptions {
  projectId: string | null;
  thumbnail: string | null;
  loaded: boolean;
  revisionRef: MutableValue<number | null>;
  documentExtensionsRef: MutableValue<Record<string, unknown>>;
  saveConflictRef: MutableValue<boolean>;
  saveConflict: boolean;
  setSaveConflict: Dispatch<SetStateAction<boolean>>;
}

export interface CanvasPersistenceState {
  saving: boolean;
  lastSaved: string | null;
  persistenceReady: boolean;
}

interface CapturedCanvasSnapshot {
  snapshot: CanvasRecoverySnapshot;
  nodeCount: number;
  connectionCount: number;
}

function isPersistableMediaUrl(url?: string): url is string {
  return Boolean(url && /^https?:\/\//.test(url));
}

/**
 * 画布 CAS 保存协调器：处理防抖、在途合并、丢响应校验、冲突暂停和退避重试。
 * UI 只消费状态，不再了解 revision 与确认回调的时序细节。
 */
export function useCanvasPersistence({
  projectId,
  thumbnail,
  loaded,
  revisionRef,
  documentExtensionsRef,
  saveConflictRef,
  saveConflict,
  setSaveConflict,
}: UseCanvasPersistenceOptions): CanvasPersistenceState {
  const nodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const groups = useCanvasStore((state) => state.groups);
  const trackedSkillRunIds = useCanvasStore((state) => state.trackedSkillRunIds);
  const materializedArtifactIds = useCanvasStore((state) => state.materializedArtifactIds);

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [persistenceReadyProjectId, setPersistenceReadyProjectId] = useState<string | null>(null);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const saveRetryAttemptsRef = useRef(0);
  const pendingSaveRef = useRef(false);
  const saveAcknowledgementsRef = useRef<Array<(saved: boolean) => void>>([]);
  const activeSaveSnapshotRef = useRef<CanvasRecoverySnapshot | null>(null);
  const recoveryStorageWarningRef = useRef(false);
  const recoveryRetryProjectRef = useRef<string | null>(null);

  const captureSnapshot = useCallback((): CapturedCanvasSnapshot | null => {
    const expectedRevision = revisionRef.current;
    if (!projectId || expectedRevision === null) return null;
    const store = useCanvasStore.getState();
    const canvasData = serializeCanvasDocument({
      extensions: documentExtensionsRef.current,
      sanitizeNode: sanitizeCanvasNodeForPersistence,
      document: {
        nodes: store.nodes,
        connections: store.connections,
        groups: store.groups,
        skillRuns: {
          trackedRunIds: store.trackedSkillRunIds,
          materializedArtifactIds: store.materializedArtifactIds,
        },
      },
    });
    // data/blob 地址不能进入后端短字符串封面字段。
    const cover = (isPersistableMediaUrl(thumbnail ?? undefined) ? thumbnail : null)
      ?? store.nodes.find(
        (node) => isImageCanvasNodeType(node.type) && isPersistableMediaUrl(node.imageSrc),
      )?.imageSrc
      ?? undefined;
    return {
      snapshot: {
        expectedRevision,
        canvasData,
        ...(cover ? { thumbnail: cover } : {}),
      },
      nodeCount: store.nodes.length,
      connectionCount: store.connections.length,
    };
  }, [documentExtensionsRef, projectId, revisionRef, thumbnail]);

  const stageCapturedSnapshot = useCallback((
    captured: CapturedCanvasSnapshot,
    predecessor?: CanvasRecoverySnapshot | null,
  ): void => {
    if (!projectId) return;
    const userId = useAuthStore.getState().user?.id;
    const staged = stageCanvasRecoveryDraft({
      projectId,
      userId,
      ...captured.snapshot,
      predecessor,
    });
    if (!staged && !recoveryStorageWarningRef.current) {
      recoveryStorageWarningRef.current = true;
      captureCanvasWarning("canvas.persistence.recovery_draft_unavailable", { projectId });
    }
  }, [projectId]);

  const stageCurrentSnapshot = useCallback((): void => {
    const captured = captureSnapshot();
    if (captured) stageCapturedSnapshot(captured, activeSaveSnapshotRef.current);
  }, [captureSnapshot, stageCapturedSnapshot]);

  const stageCurrentSnapshotRef = useRef(stageCurrentSnapshot);
  useEffect(() => {
    stageCurrentSnapshotRef.current = stageCurrentSnapshot;
  }, [stageCurrentSnapshot]);

  const save = useCallback(async (silent = false): Promise<boolean> => {
    if (!projectId || saveConflictRef.current || revisionRef.current === null) return false;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      stageCurrentSnapshotRef.current();
      return false;
    }

    const captured = captureSnapshot();
    if (!captured) return false;
    const attempt = captured.snapshot;
    stageCapturedSnapshot(captured);

    const acknowledgements = saveAcknowledgementsRef.current.splice(0);
    let persisted = false;
    let reconciliation: CanvasSaveReconciliation | null = null;
    let retryAutomatically = false;
    savingRef.current = true;
    activeSaveSnapshotRef.current = attempt;
    setSaving(true);

    try {
      const response = await projectApi.saveCanvas(projectId, {
        canvasData: attempt.canvasData,
        expectedRevision: attempt.expectedRevision,
        ...(attempt.thumbnail ? { thumbnail: attempt.thumbnail } : {}),
      });

      if (
        response.success
        && Number.isSafeInteger(response.data?.revision)
        && response.data.revision === attempt.expectedRevision + 1
      ) {
        revisionRef.current = response.data.revision;
        saveRetryAttemptsRef.current = 0;
        reconciliation = { kind: "acknowledged", revision: response.data.revision };
        persisted = true;
      } else {
        // PUT 可能已提交但响应丢失；读取权威快照后再判断冲突。
        const remote = await projectApi.get(projectId);
        reconciliation = reconcileCanvasSave(
          attempt,
          remote.success && remote.data
            ? {
                revision: remote.data.revision,
                canvasData: remote.data.canvasData,
                thumbnail: remote.data.thumbnail,
              }
            : undefined,
        );
        retryAutomatically = reconciliation.kind === "retry"
          && (response.success || isTransientCanvasSaveCode(response.code))
          && (remote.success || isTransientCanvasSaveCode(remote.code));

        if (reconciliation.kind === "acknowledged") {
          revisionRef.current = reconciliation.revision;
          saveRetryAttemptsRef.current = 0;
          persisted = true;
        } else if (reconciliation.kind === "conflict") {
          saveConflictRef.current = true;
          pendingSaveRef.current = false;
          setSaveConflict(true);
          const queued = saveAcknowledgementsRef.current.splice(0);
          queued.forEach((acknowledge) => acknowledge(false));
          toast.error("检测到其他窗口更新，已暂停自动保存");
          captureCanvasEvent("canvas.persistence.conflict", { projectId });
        } else if (!silent) {
          toast.error(response.message || "保存失败，将自动重试");
        }
      }

      if (persisted) {
        const acknowledgedRevision = revisionRef.current;
        if (acknowledgedRevision !== null) {
          acknowledgeCanvasRecoveryDraft({
            projectId,
            userId: useAuthStore.getState().user?.id,
            snapshot: attempt,
            revision: acknowledgedRevision,
          });
        }
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        captureCanvasEvent("canvas.persistence.saved", {
          projectId,
          nodeCount: captured.nodeCount,
          connectionCount: captured.connectionCount,
        });
        if (!silent) toast.success("已保存");
      }
    } catch (error) {
      reconciliation = { kind: "retry" };
      retryAutomatically = true;
      captureCanvasError("canvas.persistence.failed", error, { projectId });
      if (!silent) toast.error("保存失败，将自动重试");
    } finally {
      acknowledgements.forEach((acknowledge) => acknowledge(persisted));
      savingRef.current = false;
      if (activeSaveSnapshotRef.current === attempt) activeSaveSnapshotRef.current = null;
      setSaving(false);

      if (!saveConflictRef.current) {
        const queued = pendingSaveRef.current;
        const followUp = reconciliation
          ? nextCanvasSaveFollowUp(reconciliation, queued, retryAutomatically)
          : queued ? "immediate" : "none";
        pendingSaveRef.current = false;

        if (followUp === "immediate") {
          void saveRef.current(true);
        } else if (followUp === "delayed" && !autosaveTimerRef.current) {
          const attempt = saveRetryAttemptsRef.current + 1;
          saveRetryAttemptsRef.current = attempt;
          const delay = Math.min(
            MAX_RETRY_DELAY_MS,
            AUTOSAVE_DELAY_MS * (2 ** Math.min(3, attempt - 1)),
          );
          autosaveTimerRef.current = setTimeout(() => {
            autosaveTimerRef.current = null;
            void saveRef.current(true);
          }, delay);
        }
      }
    }

    return persisted;
  }, [
    captureSnapshot,
    projectId,
    revisionRef,
    saveConflictRef,
    setSaveConflict,
    stageCapturedSnapshot,
  ]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // SkillRun 恢复日志要求明确的持久化确认边界。
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const acknowledgements = saveAcknowledgementsRef.current;
    const handleSaveNow = (rawEvent: Event): void => {
      const event = rawEvent as CustomEvent<CanvasSaveRequestDetail | undefined>;
      const detail = event.detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      // 生成结果写入 store 后先同步留恢复快照，再开始/排队网络保存。
      stageCurrentSnapshotRef.current();
      if (saveConflictRef.current) {
        if (detail) {
          detail.handled = true;
          detail.acknowledge(false);
        }
        return;
      }
      if (detail) {
        detail.handled = true;
        acknowledgements.push(detail.acknowledge);
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (savingRef.current) {
        pendingSaveRef.current = true;
      } else {
        void saveRef.current(true);
      }
    };

    window.addEventListener(CANVAS_SAVE_NOW_EVENT, handleSaveNow);
    queueMicrotask(() => {
      if (active) setPersistenceReadyProjectId(projectId);
    });
    return () => {
      active = false;
      window.removeEventListener(CANVAS_SAVE_NOW_EVENT, handleSaveNow);
      const pending = acknowledgements.splice(0);
      pending.forEach((acknowledge) => acknowledge(false));
    };
  }, [projectId, saveConflictRef]);

  // 离开页面时立即冲刷尚未触发的防抖保存。
  useEffect(() => () => {
    if (!autosaveTimerRef.current) return;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    void saveRef.current(true);
  }, []);

  // 刷新恢复出的草稿跳过 3 秒防抖，挂载后立即按当前服务端 revision 重试。
  useEffect(() => {
    if (!loaded || saveConflict || !projectId) {
      recoveryRetryProjectRef.current = null;
      return;
    }
    if (recoveryRetryProjectRef.current === projectId) return;
    const userId = useAuthStore.getState().user?.id;
    if (!hasCanvasRecoveryDraft(projectId, userId)) return;
    recoveryRetryProjectRef.current = projectId;
    queueMicrotask(() => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      void saveRef.current(true);
    });
  }, [loaded, projectId, saveConflict]);

  useEffect(() => {
    if (!loaded || saveConflict) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void save(true);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [
    connections,
    groups,
    loaded,
    materializedArtifactIds,
    nodes,
    save,
    saveConflict,
    trackedSkillRunIds,
  ]);

  return {
    saving,
    lastSaved,
    persistenceReady: persistenceReadyProjectId === projectId,
  };
}
