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
import { serializeCanvasDocument } from "../../infrastructure/persistence/serialize-canvas-document";
import { sanitizeCanvasNodeForPersistence } from "../../infrastructure/persistence/sanitize-canvas-node";
import {
  captureCanvasError,
  captureCanvasEvent,
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

  const save = useCallback(async (silent = false): Promise<boolean> => {
    if (!projectId || saveConflictRef.current || revisionRef.current === null) return false;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }

    const acknowledgements = saveAcknowledgementsRef.current.splice(0);
    let persisted = false;
    let reconciliation: CanvasSaveReconciliation | null = null;
    let retryAutomatically = false;
    savingRef.current = true;
    setSaving(true);

    try {
      // 卸载 flush 可能早于 React 闭包更新，必须直接读取当前 store 快照。
      const snapshot = useCanvasStore.getState();
      const canvasData = serializeCanvasDocument({
        extensions: documentExtensionsRef.current,
        sanitizeNode: sanitizeCanvasNodeForPersistence,
        document: {
          nodes: snapshot.nodes,
          connections: snapshot.connections,
          groups: snapshot.groups,
          skillRuns: {
            trackedRunIds: snapshot.trackedSkillRunIds,
            materializedArtifactIds: snapshot.materializedArtifactIds,
          },
        },
      });

      // data/blob 地址不能进入后端短字符串封面字段。
      const cover = (isPersistableMediaUrl(thumbnail ?? undefined) ? thumbnail : null)
        ?? snapshot.nodes.find(
          (node) => isImageCanvasNodeType(node.type) && isPersistableMediaUrl(node.imageSrc),
        )?.imageSrc
        ?? null;
      const expectedRevision = revisionRef.current;
      const sentThumbnail = cover || undefined;
      const response = await projectApi.saveCanvas(projectId, {
        canvasData,
        expectedRevision,
        ...(sentThumbnail ? { thumbnail: sentThumbnail } : {}),
      });

      if (
        response.success
        && Number.isSafeInteger(response.data?.revision)
        && response.data.revision === expectedRevision + 1
      ) {
        revisionRef.current = response.data.revision;
        saveRetryAttemptsRef.current = 0;
        reconciliation = { kind: "acknowledged", revision: response.data.revision };
        persisted = true;
      } else {
        // PUT 可能已提交但响应丢失；读取权威快照后再判断冲突。
        const remote = await projectApi.get(projectId);
        reconciliation = reconcileCanvasSave(
          { expectedRevision, canvasData, thumbnail: sentThumbnail },
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
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        captureCanvasEvent("canvas.persistence.saved", {
          projectId,
          nodeCount: snapshot.nodes.length,
          connectionCount: snapshot.connections.length,
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
  }, [documentExtensionsRef, projectId, revisionRef, saveConflictRef, setSaveConflict, thumbnail]);

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
