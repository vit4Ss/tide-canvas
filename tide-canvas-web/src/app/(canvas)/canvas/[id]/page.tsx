"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { CanvasWorkspaceControls } from "@/components/canvas/canvas-workspace-controls";
import { CanvasProjectMenu } from "@/components/canvas/canvas-project-menu";
import { confirmDialog } from "@/components/shared/confirm";
import { useCanvasSkillRunStore } from "@/components/canvas/skill-run/use-skill-runs";
import { isSkillRunActive } from "@/types/skill-run";
import { useAuthStore } from "@/stores/use-auth-store";
import { resumeGeneration, stopAllGeneration } from "@/hooks/canvas/use-ai-generation";
import { CanvasView } from "@/components/canvas/canvas-view";
import { Loader2, Check, TriangleAlert, RefreshCw } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { isImageCanvasNodeType } from "@/lib/canvas-node-types";
import { CANVAS_SAVE_NOW_EVENT, requestCanvasSave, type CanvasSaveRequestDetail } from "@/lib/canvas-save";
import {
  isTransientCanvasSaveCode,
  nextCanvasSaveFollowUp,
  reconcileCanvasSave,
  settleCanvasSaveAcknowledgements,
  rejectCanvasSaveRetryQueueWhenIdle,
  type CanvasSaveReconciliation,
} from "@/lib/canvas-save-reconcile";
import {
  clearCanvasLaunchJournal,
  readCanvasLaunchJournal,
  type CanvasLaunchJournal,
} from "@/lib/canvas-launch";
import { initialCanvasWorkspace, parseCanvasWorkspace, captureWorkspaceCanvas, serializeCanvasWorkspace, createWorkspaceCanvasId, renameWorkspaceCanvas, copyWorkspaceCanvas, deleteWorkspaceCanvas, workspaceCanvasHref, type CanvasViewMode } from "@/lib/canvas-document";
import { useAppUpdateGuard } from "@/hooks/use-app-update-guard";
import { persistableProjectThumbnail } from "@/lib/canvas-thumbnail";

const AUTOSAVE_DELAY = 3000; // 3 秒无变化触发自动保存

/** blob: 是本地临时预览地址(上传中/切图中),刷新即失效,持久化等于把内容变成死链 */
const isBlobUrl = (u?: string): boolean => !!u && u.startsWith("blob:");
const hasPendingCanvasWork = (nodes: CanvasNode[]) => nodes.some((node) => node.uploading || node.status === "generating" || node.pendingGeneration || isBlobUrl(node.imageSrc) || isBlobUrl(node.videoSrc) || isBlobUrl(node.audioSrc) || node.images?.some(isBlobUrl) || node.audioTracks?.some((track) => isBlobUrl(track.url)));

/** 序列化前剥掉节点上的 blob: 地址:上传常超过自动保存的 3s 防抖窗口,
 *  原样落盘会在"上传完成前关页"时把死链写进 canvasData,重开后内容永久丢失。
 *  剥掉后该节点显示为空,待上传/切图完成写回真实 URL 时会自然触发下一轮保存。 */
function sanitizeForSave(n: CanvasNode): CanvasNode {
  const dirty =
    isBlobUrl(n.imageSrc) || isBlobUrl(n.videoSrc) || isBlobUrl(n.audioSrc) ||
    n.images?.some(isBlobUrl) || n.audioTracks?.some((t) => isBlobUrl(t.url));
  if (!dirty) return n;
  const c = { ...n };
  if (isBlobUrl(c.imageSrc)) delete c.imageSrc;
  if (isBlobUrl(c.videoSrc)) delete c.videoSrc;
  if (isBlobUrl(c.audioSrc)) delete c.audioSrc;
  if (c.images) {
    c.images = c.images.filter((u) => !isBlobUrl(u));
    if (c.images.length === 0) delete c.images;
  }
  if (c.audioTracks) {
    c.audioTracks = c.audioTracks.filter((t) => !isBlobUrl(t.url));
    if (c.audioTracks.length === 0) delete c.audioTracks;
  }
  return c;
}

export default function CanvasEditorPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  // URL 里的 [id] 实为不透明 url token，真实数值ID不在地址栏暴露
  const token = params.id as string;
  const handoffId = searchParams.get("handoff") || "";
  const requestedCanvasId = searchParams.get("canvas") || "";
  const requestedCanvasIdRef = useRef(requestedCanvasId);
  useEffect(() => { requestedCanvasIdRef.current = requestedCanvasId; }, [requestedCanvasId]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [projectName, setProjectName] = useState("加载中...");
  const [editingName, setEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const workspaceRef = useRef(initialCanvasWorkspace());
  const [canvasList, setCanvasList] = useState(() => initialCanvasWorkspace().canvases.map(({ id, name }) => ({ id, name })));
  const [activeCanvasId, setActiveCanvasId] = useState("canvas-1");
  const [viewMode, setViewMode] = useState<CanvasViewMode>("workflow");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const viewModeRef = useRef<CanvasViewMode>("workflow");
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [switchingCanvas, setSwitchingCanvas] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const projectActionRef = useRef(false);
  const switchingCanvasRef = useRef(false);
  const assistantBusyRef = useRef(false);
  const handleAssistantBusy = useCallback((busy: boolean) => { assistantBusyRef.current = busy; }, []);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [loadFailure, setLoadFailure] = useState(false);
  const [launchJournal, setLaunchJournal] = useState<CanvasLaunchJournal | null>(null);
  const [persistenceReadyProjectId, setPersistenceReadyProjectId] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<{
    journal: CanvasLaunchJournal;
    projectId: string;
    ownerId: string;
  } | null>(null);

  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
  const trackedSkillRunIds = useCanvasStore((s) => s.trackedSkillRunIds);
  const materializedArtifactIds = useCanvasStore((s) => s.materializedArtifactIds);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const setCurrentProjectId = useCanvasStore((s) => s.setCurrentProjectId);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const authUserId = useAuthStore((s) => s.user?.id);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Latest `saving` read via a ref so `save` isn't recreated when it flips —
  // otherwise the autosave effect (which depends on `save`) re-runs on every
  // setSaving and self-perpetuates a ~3s save loop even with no edits.
  const savingRef = useRef(false);
  const revisionRef = useRef<number | null>(null);
  const saveConflictRef = useRef(false);
  const saveRetryAttemptsRef = useRef(0);
  // Loading a project populates the same store observed by autosave. That
  // hydration is not a user edit and must not increment the remote revision or
  // persist a salvaged/normalized document just because the project was opened.
  const skipHydrationAutosaveRef = useRef(false);
  // 保存在途时又触发保存(慢网络下防抖计时器到点):不能直接丢弃——那可能是
  // 用户的最后一次编辑,之后再无触发源,改动会永远不落盘。记 pending,在途
  // 请求结束后补跑一次。
  const pendingSaveRef = useRef(false);
  // Acknowledgements are captured per save attempt. Requests arriving while a
  // save is in flight stay queued for the follow-up snapshot, never the stale one.
  const saveAcknowledgementsRef = useRef<Array<(saved: boolean) => void>>([]);
  // 清理 handoff 查询参数不应重新加载整个画布并打断刚启动的任务轮询；
  // token 真正变化时则读取该次导航对应的最新 handoff。
  const handoffIdRef = useRef(handoffId);
  useEffect(() => {
    handoffIdRef.current = handoffId;
  }, [handoffId]);

  // 加载项目（按 url token；不存在/无权限 → 404）
  useEffect(() => {
    let cancelled = false;
    skipHydrationAutosaveRef.current = true;
    revisionRef.current = null;
    saveConflictRef.current = false;
    const requestedHandoffId = handoffIdRef.current;
    void (async () => {
      if (!await ensureSession() || cancelled) return;
      const res = await projectApi.getByToken(token);
      if (cancelled) return;
      if (res.success && res.data) {
        setLoadFailure(false);
        setSaveConflict(false);
        const resolvedProjectId = String(res.data.id);
        setProjectId(resolvedProjectId);
        setCurrentProjectId(resolvedProjectId);
        setProjectName(res.data.name);
        setThumbnail(res.data.thumbnail || null);
        revisionRef.current = Number.isSafeInteger(res.data.revision) && res.data.revision >= 0
          ? res.data.revision
          : 0;
        if (res.data.canvasData && res.data.canvasData !== "{}") {
          try {
            const workspace = parseCanvasWorkspace(res.data.canvasData);
            const persistedActive = workspace.canvases.find((canvas) => canvas.id === workspace.activeCanvasId)!;
            const active = workspace.canvases.find((canvas) => canvas.id === requestedCanvasIdRef.current) || persistedActive;
            workspaceRef.current = { ...workspace, activeCanvasId: active.id };
            setCanvasList(workspace.canvases.map(({ id, name }) => ({ id, name })));
            setActiveCanvasId(active.id);
            setViewMode(active.viewMode);
            viewModeRef.current = active.viewMode;
            useCanvasViewStore.getState().setTransform(active.viewport);
            const data = active.document;
            loadCanvas(
              data.nodes,
              data.connections,
              data.groups,
              persistedActive.document.skillRuns,
            );
            // 上次会话遗留的生成中节点（带 taskId）：任务仍在后端执行，按任务号续轮回填结果
            resumeGeneration();
          } catch {
            loadCanvas([], []);
            // Never autosave the empty fallback over a malformed remote canvas.
            // Keep the project read-only until a reload or server-side repair.
            saveConflictRef.current = true;
            setLoadFailure(true);
            setSaveConflict(true);
            toast.error("画布数据读取失败，已暂停保存以保护原始数据");
          }
        } else {
          // 空项目必须显式清空:store 是全局单例,不清则上一个项目的节点残留在此项目里
          // 显示,且随后自动保存会把上个项目的画布写进本项目(数据串档)。
          loadCanvas([], []);
          workspaceRef.current = initialCanvasWorkspace();
          setCanvasList([{ id: "canvas-1", name: "画布 1" }]);
          setActiveCanvasId("canvas-1");
          setViewMode("workflow");
          viewModeRef.current = "workflow";
          useCanvasViewStore.getState().setTransform({ x: 0, y: 0, k: 1 });
        }

        if (requestedHandoffId && !useAuthStore.getState().user) {
          await useAuthStore.getState().fetchUser();
          if (cancelled) return;
        }
        const candidate = requestedHandoffId ? readCanvasLaunchJournal(requestedHandoffId) : null;
        if (candidate) {
          const currentUserId = useAuthStore.getState().user?.id;
          const ownerId = res.data.ownerId || res.data.owner?.id;
          if (!currentUserId) {
            // 身份接口暂时失败时，公开 token 能加载画布但不能证明当前用户。
            // 只暂存校验上下文；身份重试由独立 effect 处理，绝不重新 loadCanvas
            // 覆盖用户随后产生的本地编辑。
            setLaunchJournal(null);
            setPendingHandoff({
              journal: candidate,
              projectId: resolvedProjectId,
              ownerId: String(ownerId || ""),
            });
          } else {
            const validHandoff = candidate.projectId === resolvedProjectId
              && candidate.urlToken === token
              && candidate.creatorUserId === String(currentUserId)
              && candidate.creatorUserId === String(ownerId || "");
            setPendingHandoff(null);
            if (validHandoff) {
              setLaunchJournal(candidate);
            } else {
              setLaunchJournal(null);
              toast.error("创作草稿与当前画布不匹配，已停止自动执行");
              router.replace(`/canvas/${encodeURIComponent(token)}`);
            }
          }
        } else {
          setPendingHandoff(null);
          setLaunchJournal(null);
          if (requestedHandoffId) {
            toast.info("创作草稿已失效，请返回项目页重新运行");
            router.replace(`/canvas/${encodeURIComponent(token)}`);
          }
        }
        setLoaded(true);
      } else {
        setMissing(true);
      }
    })();
    // stopAllGeneration:轮询是画布级单例,离开页面/切换项目必须显式停掉,
    // 否则残留轮询会往已切换项目的全局 store 里写结果
    return () => {
      cancelled = true;
      setCurrentProjectId(null);
      stopAllGeneration();
    };
  }, [ensureSession, loadCanvas, router, setCurrentProjectId, token]);

  // `/me` 瞬时失败时只重试身份确认，不重取项目、不覆盖画布、不打断任务轮询。
  // 如果稍后由其它入口恢复 user，authUserId 变化也会立即重新校验。
  useEffect(() => {
    if (!pendingHandoff) return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | null = null;

    const confirmIdentity = async () => {
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
          }, 1200 * attempts);
        } else {
          toast.info("登录信息暂未确认；已保留创作草稿，网络恢复后刷新可继续");
        }
        return;
      }

      const { journal, projectId: pendingProjectId, ownerId } = pendingHandoff;
      const validHandoff = journal.projectId === pendingProjectId
        && journal.urlToken === token
        && journal.creatorUserId === String(currentUserId)
        && journal.creatorUserId === ownerId;
      setPendingHandoff(null);
      if (validHandoff) {
        setLaunchJournal(journal);
      } else {
        setLaunchJournal(null);
        toast.error("创作草稿与当前画布不匹配，已停止自动执行");
        router.replace(`/canvas/${encodeURIComponent(token)}`);
      }
    };

    void confirmIdentity();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [authUserId, pendingHandoff, router, token]);

  const save = useCallback(async (silent = false) => {
    if (!projectId || saveConflictRef.current || revisionRef.current == null) return false;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }
    const acknowledgements = saveAcknowledgementsRef.current.splice(0);
    let persisted = false;
    let reconciliation: CanvasSaveReconciliation | null = null;
    let retryAutomatically = false;
    let persistenceRequestStarted = false;
    savingRef.current = true;
    setSaving(true);
    try {
      // 保存触发可能来自卸载 flush；此时 React 闭包未必已经跟上最后一次 store 更新。
      // 直接读取 store 快照，确保刚物化的节点和 artifact 消费标记一起落盘。
      const canvasSnapshot = useCanvasStore.getState();
      workspaceRef.current = captureWorkspaceCanvas(workspaceRef.current, {
        nodes: canvasSnapshot.nodes,
        connections: canvasSnapshot.connections,
        groups: canvasSnapshot.groups,
        skillRuns: {
          trackedRunIds: canvasSnapshot.trackedSkillRunIds,
          materializedArtifactIds: canvasSnapshot.materializedArtifactIds,
        },
      }, useCanvasViewStore.getState().transform, viewModeRef.current);
      const canvasData = serializeCanvasWorkspace(workspaceRef.current, sanitizeForSave);
      // 封面兜底：未手动设封面时，自动用画布中第一张图片。
      // 仅取可持久化的 http(s) 地址——data:base64 会超出后端 thumbnail(VARCHAR 512) 导致保存 500，
      // blob: 本地地址刷新即失效（如刚切分尚未上传完成的切片），都不能当封面。
      const cover = (persistableProjectThumbnail(thumbnail) ? thumbnail : null)
        ?? canvasSnapshot.nodes.find((n) => isImageCanvasNodeType(n.type) && persistableProjectThumbnail(n.imageSrc))?.imageSrc
        ?? null;
      const expectedRevision = revisionRef.current;
      const sentThumbnail = cover || undefined;
      persistenceRequestStarted = true;
      const res = await projectApi.saveCanvas(projectId, {
        canvasData,
        expectedRevision,
        ...(sentThumbnail ? { thumbnail: sentThumbnail } : {}),
      });
      if (res.success && Number.isSafeInteger(res.data?.revision) && res.data.revision === expectedRevision + 1) {
        revisionRef.current = res.data.revision;
        saveRetryAttemptsRef.current = 0;
        reconciliation = { kind: "acknowledged", revision: res.data.revision };
        persisted = true;
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        if (!silent) toast.success("已保存");
      } else {
        // A lost response after COMMIT is indistinguishable from a failed PUT.
        // Read the authoritative snapshot before declaring a conflict: if our
        // exact write is already there, advance the local revision and flush
        // edits made while the request was in flight.
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
          && (res.success || isTransientCanvasSaveCode(res.code))
          && (remote.success || isTransientCanvasSaveCode(remote.code));

        if (reconciliation.kind === "acknowledged") {
          revisionRef.current = reconciliation.revision;
          saveRetryAttemptsRef.current = 0;
          persisted = true;
          setLastSaved(new Date().toLocaleTimeString("zh-CN"));
          if (!silent) toast.success("已保存");
        } else if (reconciliation.kind === "conflict") {
          saveConflictRef.current = true;
          pendingSaveRef.current = false;
          setSaveConflict(true);
          const queued = saveAcknowledgementsRef.current.splice(0);
          for (const acknowledge of queued) acknowledge(false);
          toast.error("检测到其他窗口更新，已暂停自动保存");
        } else if (!silent) {
          toast.error(res.message || "保存失败，将自动重试");
        }
      }
    } catch {
      // Keep durability waiters attached to the same snapshot. The HTTP client
      // normally returns a Result, but browser/proxy exceptions must follow the
      // same bounded retry path instead of becoming an unhandled rejection.
      reconciliation = { kind: "retry" };
      retryAutomatically = persistenceRequestStarted;
      if (!silent) toast.error(persistenceRequestStarted ? "保存失败，将自动重试" : "画布数据异常，无法保存");
    } finally {
      savingRef.current = false;
      setSaving(false);
      let followUp: ReturnType<typeof nextCanvasSaveFollowUp> = "none";
      if (!saveConflictRef.current) {
        const queued = pendingSaveRef.current;
        followUp = reconciliation
          ? nextCanvasSaveFollowUp(reconciliation, queued, retryAutomatically)
          : queued ? "immediate" : "none";
        pendingSaveRef.current = false;
        // Requests that arrived during this save are already in the shared
        // queue. A transient failure keeps this attempt's waiters in front so
        // the retry snapshot that contains their task data acknowledges all.
        settleCanvasSaveAcknowledgements(
          acknowledgements, saveAcknowledgementsRef.current, persisted, followUp,
        );
        rejectCanvasSaveRetryQueueWhenIdle(
          saveAcknowledgementsRef.current, persisted, followUp,
        );
        if (followUp === "immediate") {
          // 经 saveRef 取最新版本,带上在途期间的新编辑
          void saveRef.current(true);
        } else if (followUp === "delayed" && !autosaveTimerRef.current) {
          const attempt = saveRetryAttemptsRef.current + 1;
          saveRetryAttemptsRef.current = attempt;
          const delay = Math.min(30_000, AUTOSAVE_DELAY * (2 ** Math.min(3, attempt - 1)));
          autosaveTimerRef.current = setTimeout(() => {
            autosaveTimerRef.current = null;
            void saveRef.current(true);
          }, delay);
        }
      } else {
        for (const acknowledge of acknowledgements) acknowledge(false);
      }
    }
    return persisted;
  }, [projectId, thumbnail]);

  // Keep a ref to the latest `save` so the unmount flush below (which has empty
  // deps) always calls the current version without re-subscribing.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useAppUpdateGuard(!loaded || saveConflict || editingName || switchingCanvas || projectActionBusy, () => {
    const timerPending = !!autosaveTimerRef.current;
    const savePending = savingRef.current || pendingSaveRef.current;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if ((timerPending || savePending) && !savingRef.current) {
      pendingSaveRef.current = false;
      void saveRef.current(true);
    }
    if (timerPending || savePending) {
      // The global updater catches this and retries after the save boundary.
      throw new Error("canvas save pending");
    }
  });

  // SkillRun recovery journaling needs a real persistence boundary. A caller
  // receives success only from the request that serialized its latest changes.
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const acknowledgements = saveAcknowledgementsRef.current;
    const handleSaveNow = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<CanvasSaveRequestDetail | undefined>;
      const detail = event.detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      // requestCanvasSave will retry briefly while the project revision is
      // still being installed; do not claim the event and strand its waiter.
      if (revisionRef.current == null) return;
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
      for (const acknowledge of pending) acknowledge(false);
    };
  }, [projectId]);

  // Flush a pending autosave on unmount/navigate: if the debounce timer is still
  // armed when the canvas unmounts, the last edits would otherwise be dropped.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        // fire-and-forget; the request outlives this component.
        void saveRef.current(true);
      }
    };
  }, []);

  // 自动保存：除画布图结构外，也持久化 SkillRun 恢复/消费状态。
  useEffect(() => {
    if (!loaded || saveConflict) return;
    if (skipHydrationAutosaveRef.current) {
      skipHydrationAutosaveRef.current = false;
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null; // mark flushed so the unmount flush won't re-save
      save(true);
    }, AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, connections, groups, trackedSkillRunIds, materializedArtifactIds, loaded, save, saveConflict, workspaceVersion]);

  const handleViewChange = useCallback((mode: CanvasViewMode) => {
    if (viewModeRef.current === mode) return;
    viewModeRef.current = mode;
    setViewMode(mode);
    setWorkspaceVersion((value) => value + 1);
  }, []);

  const handleCanvasSwitch = async (targetId?: string, action?: { type: "copy" | "delete"; id: string }) => {
    if (!projectId || !loaded || switchingCanvasRef.current || projectActionRef.current || saveConflictRef.current || launchJournal) return;
    const snapshot = useCanvasStore.getState();
    const skillState = useCanvasSkillRunStore.getState();
    if (assistantBusyRef.current || hasPendingCanvasWork(snapshot.nodes) || Object.values(skillState.runs).some((run) => isSkillRunActive(run.status))) {
      toast.info("当前画布有任务执行中，请等待完成后切换画布");
      return;
    }
    switchingCanvasRef.current = true;
    setSwitchingCanvas(true);
    try {
      if (!await requestCanvasSave(projectId)) { toast.error("当前画布尚未保存成功，请稍后重试切换"); return; }
      if (useCanvasStore.getState().currentProjectId !== projectId) return;
      const current = useCanvasStore.getState();
      if (assistantBusyRef.current || hasPendingCanvasWork(current.nodes)) { toast.info("素材或任务仍在处理中，请完成后再切换画布"); return; }
      const skillRuns = { trackedRunIds: current.trackedSkillRunIds, materializedArtifactIds: current.materializedArtifactIds };
      let workspace = captureWorkspaceCanvas(workspaceRef.current, { nodes: current.nodes, connections: current.connections, groups: current.groups, skillRuns }, useCanvasViewStore.getState().transform, viewModeRef.current);
      if (action) {
        workspace = action.type === "copy" ? copyWorkspaceCanvas(workspace, action.id, createWorkspaceCanvasId()) : deleteWorkspaceCanvas(workspace, action.id);
        targetId = workspace.activeCanvasId;
      } else if (!targetId) {
        targetId = createWorkspaceCanvasId();
        let number = workspace.canvases.length + 1;
        while (workspace.canvases.some((canvas) => canvas.name === `画布 ${number}`)) number += 1;
        workspace = { ...workspace, canvases: [...workspace.canvases, { id: targetId, name: `画布 ${number}`, document: { nodes: [], connections: [], groups: [], skillRuns }, viewport: { x: 0, y: 0, k: 1 }, viewMode: "workflow" }] };
      }
      const target = workspace.canvases.find((canvas) => canvas.id === targetId);
      if (!target) return;
      const activeChanged = workspaceRef.current.activeCanvasId !== target.id;
      workspaceRef.current = { ...workspace, activeCanvasId: target.id };
      if (activeChanged) {
        stopAllGeneration();
        // Skill artifacts are consumed once per project across all its canvases.
        loadCanvas(target.document.nodes, target.document.connections, target.document.groups, skillRuns);
        useCanvasViewStore.getState().setTransform(target.viewport);
        viewModeRef.current = target.viewMode;
        setViewMode(target.viewMode);
        setActiveCanvasId(target.id);
        resumeGeneration();
      }
      setCanvasList(workspace.canvases.map(({ id, name }) => ({ id, name })));
      setWorkspaceVersion((value) => value + 1);
      router.replace(workspaceCanvasHref(token, target.id));
      if (!await requestCanvasSave(projectId)) toast.error("画布已在本地切换，网络恢复后将自动重试保存，请暂勿关闭页面");
    } catch {
      toast.error("画布操作失败，当前内容已保留，请重试");
    } finally {
      switchingCanvasRef.current = false;
      setSwitchingCanvas(false);
    }
  };

  const handleCanvasRename = async (id: string, name: string): Promise<boolean> => {
    if (!projectId || projectActionRef.current || switchingCanvasRef.current || saveConflictRef.current) return false;
    projectActionRef.current = true;
    setProjectActionBusy(true);
    try {
      if (!await requestCanvasSave(projectId)) { toast.error("画布尚未保存成功，请稍后重试"); return false; }
      if (useCanvasStore.getState().currentProjectId !== projectId) return false;
      workspaceRef.current = renameWorkspaceCanvas(workspaceRef.current, id, name);
      setCanvasList(workspaceRef.current.canvases.map(({ id, name }) => ({ id, name })));
      setWorkspaceVersion((value) => value + 1);
      if (!await requestCanvasSave(projectId)) { toast.error("名称已在本地更新，网络恢复后将重试保存，请暂勿关闭页面"); return false; }
      return true;
    } catch { toast.error("重命名失败，请重试"); return false; }
    finally { projectActionRef.current = false; setProjectActionBusy(false); }
  };

  const handleCanvasDelete = async (id: string) => {
    const canvas = workspaceRef.current.canvases.find((item) => item.id === id);
    if (!canvas || workspaceRef.current.canvases.length <= 1 || projectActionRef.current || switchingCanvasRef.current) return;
    if (!await confirmDialog({ title: "删除画布", message: `确定删除「${canvas.name}」吗？画布中的节点、连线和分组将一并删除，此操作不可撤销。`, confirmText: "删除画布", danger: true })) return;
    await handleCanvasSwitch(undefined, { type: "delete", id });
  };

  const handleCanvasOpen = async (id: string) => {
    if (!projectId || projectActionRef.current || switchingCanvasRef.current || saveConflictRef.current || !workspaceRef.current.canvases.some((canvas) => canvas.id === id)) return;
    if (assistantBusyRef.current || hasPendingCanvasWork(useCanvasStore.getState().nodes) || Object.values(useCanvasSkillRunStore.getState().runs).some((run) => isSkillRunActive(run.status))) {
      toast.info("当前画布有任务执行中，请等待完成后在新窗口打开");
      return;
    }
    // Reserve the window inside the click event so browsers do not block it
    // after the asynchronous save. Detach its opener before loading the project.
    const opened = window.open("about:blank", "_blank");
    if (!opened) { toast.info("新窗口被浏览器拦截，请允许弹出窗口后重试"); return; }
    opened.opener = null;
    projectActionRef.current = true;
    setProjectActionBusy(true);
    try {
      if (!await requestCanvasSave(projectId)) { opened.close(); toast.error("画布尚未保存成功，请稍后重试"); return; }
      if (useCanvasStore.getState().currentProjectId !== projectId) { opened.close(); return; }
      opened.location.href = `${window.location.origin}${workspaceCanvasHref(token, id)}`;
    } catch { opened.close(); toast.error("打开画布失败，请重试"); }
    finally { projectActionRef.current = false; setProjectActionBusy(false); }
  };

  const handleProjectNavigate = async (path: string) => {
    if (projectActionRef.current || switchingCanvasRef.current) return;
    projectActionRef.current = true;
    setProjectActionBusy(true);
    try {
      if (projectId && !saveConflictRef.current && !await requestCanvasSave(projectId)) {
        toast.error("画布尚未保存成功，请稍后重试");
        return;
      }
      router.push(path);
    } finally { projectActionRef.current = false; setProjectActionBusy(false); }
  };

  const handleDeleteProject = async () => {
    if (!projectId || projectActionRef.current || switchingCanvasRef.current) return;
    if (!await confirmDialog({ title: "删除项目", message: `确定删除「${projectName}」吗？项目中的所有画布将一并删除，此操作不可撤销。`, confirmText: "删除项目", danger: true })) return;
    if (useCanvasStore.getState().currentProjectId !== projectId) return;
    projectActionRef.current = true;
    setProjectActionBusy(true);
    const previousConflict = saveConflictRef.current;
    try {
      if (!previousConflict && !await requestCanvasSave(projectId)) { toast.error("项目正在保存，请稍后重试删除"); return; }
      saveConflictRef.current = true;
      if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
      const result = await projectApi.delete(projectId);
      if (result.success) {
        stopAllGeneration();
        setCurrentProjectId(null);
        toast.success("项目已删除");
        router.replace("/projects");
      } else { saveConflictRef.current = previousConflict; toast.error(result.message || "删除失败，请重试"); }
    } catch { saveConflictRef.current = previousConflict; toast.error("删除失败，请重试"); }
    finally { projectActionRef.current = false; setProjectActionBusy(false); }
  };

  const handleStartEditName = () => {
    setEditingNameValue(projectName);
    setEditingName(true);
  };

  const confirmingNameRef = useRef(false);
  const handleConfirmName = async () => {
    // Enter 会先 setEditingName(false) 使 input 失焦触发 onBlur → 二次调用;用 ref 去重,避免重复 update 请求。
    if (confirmingNameRef.current) return;
    confirmingNameRef.current = true;
    try {
      const newName = editingNameValue.trim();
      if (!newName || newName === projectName) {
        setEditingName(false);
        return;
      }
      const prevName = projectName;
      setProjectName(newName);
      setEditingName(false);
      if (!projectId) return;
      const res = await projectApi.update(projectId, { name: newName });
      if (res.success) {
        toast.success("项目名已更新");
      } else {
        // 乐观更新失败要回滚,否则标题栏与服务端不一致直到刷新
        setProjectName(prevName);
        toast.error(res.message || "重命名失败");
      }
    } finally {
      confirmingNameRef.current = false;
    }
  };

  const launchJournalId = launchJournal?.id;
  const handleLaunchConsumed = useCallback(() => {
    if (launchJournalId) clearCanvasLaunchJournal(launchJournalId);
    setLaunchJournal(null);
    router.replace(`/canvas/${encodeURIComponent(token)}`);
  }, [launchJournalId, router, token]);

  // token 无效 / 项目不存在 → 404
  if (missing) notFound();

  return (
    <div className="canvas-page relative h-screen w-screen overflow-hidden" data-sidebar-open={sidebarOpen || undefined}>
      {loaded ? (
        <CanvasView
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          viewMode={viewMode}
          onViewChange={handleViewChange}
          onAssistantBusyChange={handleAssistantBusy}
          launchJournal={launchJournal}
          persistenceReady={persistenceReadyProjectId === projectId}
          onLaunchConsumed={handleLaunchConsumed}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-neutral-50 text-neutral-400 dark:bg-neutral-950">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="正在加载画布" />
        </div>
      )}

      {/* 左上浮层：返回 + 项目名（点按重命名） + 保存状态 */}
      <nav className="canvas-project-header" aria-label="画布项目导航">
        <CanvasProjectMenu disabled={!loaded || switchingCanvas || projectActionBusy} onNavigate={(path) => { void handleProjectNavigate(path); }} onDelete={() => { void handleDeleteProject(); }} />
        <div className="canvas-project-name">
          {editingName ? (
            <input
              autoFocus
              aria-label="项目名称"
              maxLength={100}
              onFocus={(event) => event.currentTarget.select()}
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onBlur={handleConfirmName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="canvas-project-name-input"
            />
          ) : (
            <button type="button" className="canvas-project-title" onClick={handleStartEditName} title="点击重命名项目" disabled={projectActionBusy}><span>{projectName}</span></button>
          )}
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
          ) : lastSaved ? (
            <span title={`已保存 ${lastSaved}`} className="flex h-4 w-4 shrink-0 items-center justify-center">
              <Check className="h-3.5 w-3.5 text-green-500" />
            </span>
          ) : null}
        </div>
        <CanvasWorkspaceControls canvases={canvasList} activeId={activeCanvasId} viewMode={viewMode} busy={!loaded || switchingCanvas || projectActionBusy || saveConflict || !!launchJournal} onSwitch={(id) => { void handleCanvasSwitch(id); }} onCreate={() => { void handleCanvasSwitch(); }} onOpen={(id) => { void handleCanvasOpen(id); }} onRename={handleCanvasRename} onCopy={(id) => { void handleCanvasSwitch(undefined, { type: "copy", id }); }} onDelete={(id) => { void handleCanvasDelete(id); }} onViewChange={handleViewChange} />
      </nav>

      {(switchingCanvas || projectActionBusy) && <div className="canvas-switching-overlay" role="status" aria-live="polite"><Loader2 size={18} className="animate-spin" />{switchingCanvas ? "保存并切换画布…" : "正在处理项目…"}</div>}

      {saveConflict && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm text-neutral-700 shadow-sm dark:border-amber-900/70 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{loadFailure
            ? "画布数据读取失败，当前窗口已暂停保存以避免覆盖原始数据。"
            : "此画布已在其他窗口更新，当前窗口已暂停保存。"}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 font-medium text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            加载最新版本
          </button>
        </div>
      )}
    </div>
  );
}
