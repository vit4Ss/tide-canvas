"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { resumeGeneration, stopAllGeneration } from "@/hooks/canvas/use-ai-generation";
import { CanvasView } from "@/components/canvas/canvas-view";
import { ArrowLeft, Loader2, Check, Pencil, TriangleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/shared/toast";
import { isImageCanvasNodeType } from "@/lib/canvas-node-types";
import { CANVAS_SAVE_NOW_EVENT, type CanvasSaveRequestDetail } from "@/lib/canvas-save";
import {
  isTransientCanvasSaveCode,
  nextCanvasSaveFollowUp,
  reconcileCanvasSave,
  type CanvasSaveReconciliation,
} from "@/lib/canvas-save-reconcile";
import {
  clearCanvasLaunchJournal,
  readCanvasLaunchJournal,
  type CanvasLaunchJournal,
} from "@/lib/canvas-launch";
import { parseCanvasDocument } from "@/lib/canvas-document";
import { useAppUpdateGuard } from "@/hooks/use-app-update-guard";

const AUTOSAVE_DELAY = 3000; // 3 秒无变化触发自动保存

/** blob: 是本地临时预览地址(上传中/切图中),刷新即失效,持久化等于把内容变成死链 */
const isBlobUrl = (u?: string): boolean => !!u && u.startsWith("blob:");

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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [projectName, setProjectName] = useState("加载中...");
  const [editingName, setEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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
            const data = parseCanvasDocument(res.data.canvasData);
            loadCanvas(
              data.nodes,
              data.connections,
              data.groups,
              data.skillRuns,
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
    savingRef.current = true;
    setSaving(true);
    try {
      // 保存触发可能来自卸载 flush；此时 React 闭包未必已经跟上最后一次 store 更新。
      // 直接读取 store 快照，确保刚物化的节点和 artifact 消费标记一起落盘。
      const canvasSnapshot = useCanvasStore.getState();
      const canvasData = JSON.stringify({
        nodes: canvasSnapshot.nodes.map(sanitizeForSave),
        connections: canvasSnapshot.connections,
        groups: canvasSnapshot.groups,
        skillRuns: {
          trackedRunIds: canvasSnapshot.trackedSkillRunIds,
          materializedArtifactIds: canvasSnapshot.materializedArtifactIds,
        },
      });
      // 封面兜底：未手动设封面时，自动用画布中第一张图片。
      // 仅取可持久化的 http(s) 地址——data:base64 会超出后端 thumbnail(VARCHAR 512) 导致保存 500，
      // blob: 本地地址刷新即失效（如刚切分尚未上传完成的切片），都不能当封面。
      const persistable = (u?: string): u is string => !!u && /^https?:\/\//.test(u);
      const cover = (persistable(thumbnail ?? undefined) ? thumbnail : null)
        ?? canvasSnapshot.nodes.find((n) => isImageCanvasNodeType(n.type) && persistable(n.imageSrc))?.imageSrc
        ?? null;
      const expectedRevision = revisionRef.current;
      const sentThumbnail = cover || undefined;
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
    } finally {
      for (const acknowledge of acknowledgements) acknowledge(persisted);
      savingRef.current = false;
      setSaving(false);
      if (!saveConflictRef.current) {
        const queued = pendingSaveRef.current;
        const followUp = reconciliation
          ? nextCanvasSaveFollowUp(reconciliation, queued, retryAutomatically)
          : queued ? "immediate" : "none";
        pendingSaveRef.current = false;
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

  useAppUpdateGuard(!loaded || saveConflict || editingName, () => {
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
  }, [nodes, connections, groups, trackedSkillRunIds, materializedArtifactIds, loaded, save, saveConflict]);

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
    <div className="relative h-screen w-screen overflow-hidden">
      {loaded ? (
        <CanvasView
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
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <Link
          href="/projects"
          title="返回项目列表"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {editingName ? (
            <input
              autoFocus
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onBlur={handleConfirmName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="w-44 rounded-md border border-neutral-300 px-2 py-0.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800"
            />
          ) : (
            <button onClick={handleStartEditName} title="点击重命名" className="group flex items-center gap-1.5">
              <span className="max-w-[220px] truncate text-sm font-medium">{projectName}</span>
              <Pencil className="h-3 w-3 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
          ) : lastSaved ? (
            <span title={`已保存 ${lastSaved}`} className="flex h-4 w-4 shrink-0 items-center justify-center">
              <Check className="h-3.5 w-3.5 text-green-500" />
            </span>
          ) : null}
        </div>
      </div>

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
