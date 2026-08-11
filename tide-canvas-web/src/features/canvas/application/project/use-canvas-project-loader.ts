"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "@/components/shared/toast";
import { resumeGeneration, stopAllGeneration } from "@/hooks/canvas/use-ai-generation";
import { projectApi } from "@/lib/api";
import { readCanvasLaunchJournal, type CanvasLaunchJournal } from "@/lib/canvas-launch";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { decodeCanvasDocument } from "../../domain/schemas/decode-canvas-document";
import { resolveCanvasRecoveryDraft } from "../../infrastructure/persistence/canvas-recovery-draft";
import {
  captureCanvasEvent,
  captureCanvasWarning,
} from "../../infrastructure/telemetry/canvas-telemetry";

interface MutableValue<T> {
  current: T;
}

interface PendingHandoff {
  journal: CanvasLaunchJournal;
  projectId: string;
  ownerId: string;
}

interface UseCanvasProjectLoaderOptions {
  token: string;
  handoffId: string;
  replaceRoute: (href: string) => void;
  revisionRef: MutableValue<number | null>;
  documentExtensionsRef: MutableValue<Record<string, unknown>>;
  saveConflictRef: MutableValue<boolean>;
  setSaveConflict: Dispatch<SetStateAction<boolean>>;
}

export interface CanvasProjectLoaderState {
  projectId: string | null;
  missing: boolean;
  loaded: boolean;
  projectName: string;
  setProjectName: Dispatch<SetStateAction<string>>;
  thumbnail: string | null;
  launchJournal: CanvasLaunchJournal | null;
  setLaunchJournal: Dispatch<SetStateAction<CanvasLaunchJournal | null>>;
}

/** 负责项目、存量画布和跨页启动凭据的加载，不承担保存或标题编辑。 */
export function useCanvasProjectLoader({
  token,
  handoffId,
  replaceRoute,
  revisionRef,
  documentExtensionsRef,
  saveConflictRef,
  setSaveConflict,
}: UseCanvasProjectLoaderOptions): CanvasProjectLoaderState {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [projectName, setProjectName] = useState("加载中...");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [launchJournal, setLaunchJournal] = useState<CanvasLaunchJournal | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<PendingHandoff | null>(null);

  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const setCurrentProjectId = useCanvasStore((state) => state.setCurrentProjectId);
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const authUserId = useAuthStore((state) => state.user?.id);

  // 清理 handoff 查询参数不应重新加载项目；token 真正变化时读取当时最新值。
  const handoffIdRef = useRef(handoffId);
  useEffect(() => {
    handoffIdRef.current = handoffId;
  }, [handoffId]);

  useEffect(() => {
    let cancelled = false;
    revisionRef.current = null;
    saveConflictRef.current = false;
    documentExtensionsRef.current = {};
    const requestedHandoffId = handoffIdRef.current;

    void (async () => {
      if (!await ensureSession() || cancelled) return;
      const response = await projectApi.getByToken(token);
      if (cancelled) return;

      if (!response.success || !response.data) {
        setMissing(true);
        return;
      }

      const resolvedProjectId = String(response.data.id);
      const remoteRevision = Number.isSafeInteger(response.data.revision) && response.data.revision >= 0
        ? response.data.revision
        : 0;
      const recovery = resolveCanvasRecoveryDraft(
        resolvedProjectId,
        useAuthStore.getState().user?.id,
        {
          revision: remoteRevision,
          canvasData: response.data.canvasData || "{}",
          thumbnail: response.data.thumbnail || undefined,
        },
      );
      const recoveredConflict = recovery.kind === "conflict";
      saveConflictRef.current = recoveredConflict;
      setSaveConflict(recoveredConflict);
      setProjectId(resolvedProjectId);
      setCurrentProjectId(resolvedProjectId);
      setProjectName(response.data.name);
      setThumbnail(response.data.thumbnail || null);
      revisionRef.current = recovery.revision;

      if (recovery.canvasData && recovery.canvasData !== "{}") {
        const decoded = decodeCanvasDocument(recovery.canvasData);
        documentExtensionsRef.current = decoded.extensions;
        loadCanvas(
          decoded.document.nodes,
          decoded.document.connections,
          decoded.document.groups,
          decoded.document.skillRuns,
        );
        if (decoded.warnings.length > 0) {
          captureCanvasWarning("canvas.document.recovered", {
            projectId: resolvedProjectId,
            warningCount: decoded.warnings.length,
          });
        }
        if (!recoveredConflict) resumeGeneration();
      } else {
        // Store 是跨路由单例；空项目必须显式清空，避免把上一个项目串入本项目。
        loadCanvas([], []);
      }

      if (recovery.kind === "recovered") {
        toast.info("已恢复刷新前尚未保存的画布结果，正在自动重试");
        captureCanvasEvent("canvas.persistence.recovery_draft_restored", {
          projectId: resolvedProjectId,
        });
      } else if (recoveredConflict) {
        toast.error("检测到其他窗口更新；已保留本页结果并暂停覆盖保存");
        captureCanvasWarning("canvas.persistence.recovery_draft_conflict", {
          projectId: resolvedProjectId,
        });
      }

      if (requestedHandoffId && !useAuthStore.getState().user) {
        await useAuthStore.getState().fetchUser();
        if (cancelled) return;
      }

      const candidate = requestedHandoffId
        ? readCanvasLaunchJournal(requestedHandoffId)
        : null;
      if (!candidate) {
        setPendingHandoff(null);
        setLaunchJournal(null);
        if (requestedHandoffId) {
          toast.info("创作草稿已失效，请返回项目页重新运行");
          replaceRoute(`/canvas/${encodeURIComponent(token)}`);
        }
        setLoaded(true);
        return;
      }

      const currentUserId = useAuthStore.getState().user?.id;
      const ownerId = String(response.data.ownerId || response.data.owner?.id || "");
      if (!currentUserId) {
        // 身份接口暂时失败时只暂存校验上下文，绝不重新加载并覆盖用户编辑。
        setLaunchJournal(null);
        setPendingHandoff({ journal: candidate, projectId: resolvedProjectId, ownerId });
      } else {
        const validHandoff = candidate.projectId === resolvedProjectId
          && candidate.urlToken === token
          && candidate.creatorUserId === String(currentUserId)
          && candidate.creatorUserId === ownerId;
        setPendingHandoff(null);
        if (validHandoff) {
          setLaunchJournal(candidate);
        } else {
          setLaunchJournal(null);
          toast.error("创作草稿与当前画布不匹配，已停止自动执行");
          replaceRoute(`/canvas/${encodeURIComponent(token)}`);
        }
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
      setCurrentProjectId(null);
      stopAllGeneration();
    };
  }, [
    documentExtensionsRef,
    ensureSession,
    loadCanvas,
    replaceRoute,
    revisionRef,
    saveConflictRef,
    setCurrentProjectId,
    setSaveConflict,
    token,
  ]);

  // `/me` 瞬时失败后只重试身份确认，不重取项目、不覆盖画布。
  useEffect(() => {
    if (!pendingHandoff) return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | null = null;

    const confirmIdentity = async (): Promise<void> => {
      let currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) {
        await useAuthStore.getState().fetchUser();
        if (cancelled) return;
        currentUserId = useAuthStore.getState().user?.id;
      }
      if (!currentUserId) {
        attempts += 1;
        if (attempts <= 3) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void confirmIdentity();
          }, 1_200 * attempts);
        } else {
          toast.info("登录信息暂未确认；已保留创作草稿，网络恢复后刷新可继续");
        }
        return;
      }

      const { journal, projectId: expectedProjectId, ownerId } = pendingHandoff;
      const validHandoff = journal.projectId === expectedProjectId
        && journal.urlToken === token
        && journal.creatorUserId === String(currentUserId)
        && journal.creatorUserId === ownerId;
      setPendingHandoff(null);
      if (validHandoff) {
        setLaunchJournal(journal);
      } else {
        setLaunchJournal(null);
        toast.error("创作草稿与当前画布不匹配，已停止自动执行");
        replaceRoute(`/canvas/${encodeURIComponent(token)}`);
      }
    };

    void confirmIdentity();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [authUserId, pendingHandoff, replaceRoute, token]);

  return {
    projectId,
    missing,
    loaded,
    projectName,
    setProjectName,
    thumbnail,
    launchJournal,
    setLaunchJournal,
  };
}
