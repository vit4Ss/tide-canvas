/* 生成引擎 hook — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   负责：在飞任务的全部状态（busy/cells/progs/runMeta 与 tick/poll/runId 等 ref）、
   真实后端任务的创建与轮询（startGeneration → driveRun）、无后端模型时的
   设计预览模拟、结果一键编辑（oneClickEdit）、刷新续跑（localStorage 快照）、
   以及卸载/结算时的清理与余额刷新。
   面板状态经 GenerationParams 按渲染传入，useCallback 依赖数组与原文件一致，
   闭包新鲜度语义不变。 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { aiApi } from "@/lib/api";
import { skillKindOf, skillSupportsOutput, type SkillVO } from "@/types/skill";
import { AiTaskStatus, type AiTaskVO } from "@/types/ai";
import {
  commitAcceptedAiGeneration,
  isAmbiguousAiCreateCode,
  recoverableAiGenerations,
  type PendingAiGeneration,
} from "@/lib/ai-generation-idempotency";
import type { MentionEditorHandle } from "@/components/studio/mention-prompt-editor";
import { toast } from "@/components/shared/toast";
import { markRequiredField } from "@/lib/require-field";
import { useAuthStore } from "@/stores/use-auth-store";
import { supportsOmniReference } from "@/lib/omni-reference";
import { measureImageSize, nearestAspectRatio, videoReferenceImageAspectIssue } from "@/lib/aspect-ratio";
import { ossDisplayUrl } from "@/lib/oss-display";
import {
  ACTIVE_RUN_KEY,
  activeRunStorageKey,
  EDIT_OP_HANDLER,
  RATIOS,
  TOOL_TO_HANDLER,
  TOOLS,
  THREE_D_VIEW_SLOTS,
  UPLOADS,
} from "./constants";
import type {
  ActiveRun,
  ArtworkType,
  HistItem,
  InflightRun,
  MeshHues,
  MetaTrack,
  MusicMode,
  ResultCell,
  RunMeta,
  RunParams,
  SlotData,
  ThreeDAsset,
  ThreeDViewImage,
  ToolKey,
} from "./types";
import {
  nextHistId,
  promptHue,
  refThumbsForRun,
  studioReferenceCountIssue,
  threeDAssetsFromMeta,
  threeDMultiViewLimit,
  threeDReferenceSizeIssue,
  tracksFromMeta,
} from "./utils";
import { createSubmissionGate, type SubmissionGate } from "./submission-gate";
import { studioReferenceIssue, uploadedFileUrls } from "./required-reference";
import {
  isStudioTaskNewerOrEqual,
  parseStudioTimestamp,
  upsertInflightRunNewestFirst,
} from "./inflight-run-order";

export interface GenerationParams {
  /* panel state (fresh each render) */
  prompt: string;
  count: number;
  tool: ToolKey;
  curType: ArtworkType;
  ratio: string;
  model: string;
  res: string;
  dur: string;
  imgRes: string;
  quality: string;
  musicMode: MusicMode;
  sourceClipId: string;
  sourceIsUpload: boolean;
  continueAt: string;
  lyrics: string;
  songStyle: string;
  songTitle: string;
  instrumental: boolean;
  enablePbr: boolean;
  faceCount: number;
  generateType: "Normal" | "Geometry";
  resultFormat: "" | "STL" | "USDZ" | "FBX";
  slotData: SlotData;
  studioList: StudioModelVO[];
  ratioOpts: string[];
  resOpts: string[];
  durOpts: string[];
  qualOpts: string[];
  skill: SkillVO | null;
  isAudio: boolean;
  is3D: boolean;
  isSfx: boolean;
  /* services */
  ensureSession: () => Promise<boolean>;
  refreshBalance: () => Promise<void>;
  pushHistory: (item: Omit<HistItem, "id">) => void;
  setHist: Dispatch<SetStateAction<HistItem[]>>;
  promptRef: RefObject<MentionEditorHandle | null>;
}

const STUDIO_GENERATION_SCOPES = ["studio:image", "studio:video", "studio:audio", "studio:3d"] as const;

interface ConcurrentRunControl {
  token: symbol;
  ticks: ReturnType<typeof setInterval>[];
  poll: ReturnType<typeof setTimeout> | null;
}

function studioClientRequestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `studio-${crypto.randomUUID()}`;
  }
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistActiveRun(run: ActiveRun): boolean {
  const key = activeRunStorageKey(run.ownerUserId);
  try {
    localStorage.setItem(key, JSON.stringify(run));
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Partial<ActiveRun> | null;
    return stored?.taskId === run.taskId &&
      stored?.journalScope === run.journalScope &&
      stored?.ownerUserId === run.ownerUserId;
  } catch {
    return false;
  }
}

function removePersistedActiveRun(run: Pick<ActiveRun, "taskId" | "ownerUserId">): void {
  const key = activeRunStorageKey(run.ownerUserId);
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Partial<ActiveRun> | null;
    // A different tab may have replaced this account's foreground pointer. Its
    // accepted journal is independent, so only remove the exact task we own.
    if (stored?.taskId === run.taskId && stored?.ownerUserId === run.ownerUserId) {
      localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

function validHues(value: unknown): value is MeshHues[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) =>
    Array.isArray(row) && row.length === 3 && row.every((part) => typeof part === "number" && Number.isFinite(part)),
  );
}

/** Rebuild enough Studio UI state from the frozen create when ACTIVE_RUN_KEY was
 * not committed before a reload. New journals carry the exact meta; the payload
 * fallback keeps already-written journals recoverable across deployments. */
function activeRunFromJournal(
  scope: string,
  entry: PendingAiGeneration,
  task: AiTaskVO,
  ownerUserId: string,
): ActiveRun | null {
  if (!entry.payload) return null;
  const recovery = entry.recovery && typeof entry.recovery === "object"
    ? entry.recovery as Partial<Omit<ActiveRun, "taskId" | "startedAt">>
    : {};
  const input = entry.payload.input && typeof entry.payload.input === "object"
    ? entry.payload.input
    : {};
  const inferredKind: ArtworkType = entry.payload.handler === "generate_3d"
    ? "3d"
    : entry.payload.handler.includes("video")
    ? "video"
    : entry.payload.handler.includes("audio")
      ? "audio"
      : "image";
  const taskStartedAt = parseStudioTimestamp(task.createTime);
  const kind: ArtworkType = recovery.kind === "video" || recovery.kind === "audio" || recovery.kind === "image" || recovery.kind === "3d"
    ? recovery.kind
    : inferredKind;
  const rawCount = typeof input.batchCount === "number" ? input.batchCount : 1;
  const count = Math.max(1, Math.min(16, Number(recovery.count) || rawCount || 1));
  const prompt = typeof recovery.prompt === "string"
    ? recovery.prompt
    : typeof input.prompt === "string"
      ? input.prompt
      : "";
  const hue = promptHue(prompt || task.id);
  const hues = validHues(recovery.hues)
    ? recovery.hues
    : Array.from(
        { length: count },
        (_, index) => [hue + index * 36, hue + index * 36 + 80, hue + index * 36 + 200] as MeshHues,
      );
  const ratio = typeof recovery.ratio === "string"
    ? recovery.ratio
    : typeof input.aspectRatio === "string"
      ? input.aspectRatio
      : "";
  return {
    taskId: task.id,
    ownerUserId,
    journalScope: scope,
    prompt,
    model: typeof recovery.model === "string" ? recovery.model : task.modelName || entry.payload.modelId,
    ratio,
    spec: typeof recovery.spec === "string" ? recovery.spec : ratio,
    count,
    isVid: kind === "video",
    kind,
    label: typeof recovery.label === "string" ? recovery.label : "生成任务",
    hues,
    refThumbs: Array.isArray(recovery.refThumbs)
      ? recovery.refThumbs.filter((value): value is string => typeof value === "string")
      : [],
    params: recovery.params && typeof recovery.params === "object"
      ? recovery.params as RunParams
      : undefined,
    // Prefer the authoritative task creation time. Journal timestamps can move
    // forward during an ambiguous-response retry and would otherwise make an
    // older task look newer than the real foreground run after a reload.
    startedAt: Number.isFinite(taskStartedAt) ? taskStartedAt : entry.updatedAt,
  };
}

export function useGeneration(p: GenerationParams) {
  const {
    prompt,
    count,
    tool,
    curType,
    ratio,
    model,
    res,
    dur,
    imgRes,
    quality,
    musicMode,
    sourceClipId,
    sourceIsUpload,
    continueAt,
    lyrics,
    songStyle,
    songTitle,
    instrumental,
    enablePbr,
    faceCount,
    generateType,
    resultFormat,
    slotData,
    studioList,
    ratioOpts,
    resOpts,
    durOpts,
    qualOpts,
    skill,
    isAudio,
    is3D,
    isSfx,
    ensureSession,
    refreshBalance,
    pushHistory,
    setHist,
    promptRef,
  } = p;
  const authenticatedUserId = useAuthStore((state) => state.user?.id ?? "");

  /* stage state */
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<ResultCell[]>([]);
  const [progs, setProgs] = useState<number[]>([]);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [inflightRuns, setInflightRuns] = useState<InflightRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [validatingReferences, setValidatingReferences] = useState(false);
  const [recoveringRuns, setRecoveringRuns] = useState(true);
  // full settings of the last started run (for 重新编辑 / 再次生成) + a one-shot
  // flag that fires generate() after those settings are restored to the panel.
  const lastRunRef = useRef<RunParams | null>(null);
  // One-click edits retain their run-level latch. Panel submissions use a
  // separate short-lived gate below, blocking duplicate clicks without
  // disabling intentional concurrent generations after task creation.
  const genInFlightRef = useRef(false);
  const submissionGateRef = useRef<SubmissionGate | null>(null);
  if (!submissionGateRef.current) submissionGateRef.current = createSubmissionGate();
  const submissionReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const referenceValidationRef = useRef(false);
  const mountedRef = useRef(true);
  // 异步量旧素材尺寸期间，模型或素材发生变化就放弃这次提交，不能把旧闭包发出去。
  const generationValidationSignature = JSON.stringify({
    prompt,
    count,
    model,
    tool,
    ratio,
    res,
    dur,
    imgRes,
    quality,
    musicMode,
    sourceClipId,
    continueAt,
    lyrics,
    songStyle,
    songTitle,
    instrumental,
    enablePbr,
    faceCount,
    generateType,
    resultFormat,
    slots: Object.fromEntries(Object.entries(slotData).map(([key, files]) => [
      key,
      files.map((file) => [file.url ?? "", file.width ?? 0, file.height ?? 0, !!file.uploading]),
    ])),
  });
  const generationValidationSignatureRef = useRef(generationValidationSignature);
  generationValidationSignatureRef.current = generationValidationSignature;

  // 图生 3D 场景的全景识别：上传的照片没有任何全景标记，上传完成后在后台
  // 探测真实像素比例（equirectangular ≈ 2:1），提交时同步读取。不带 is_pano
  // 提交时 Marble 会把全景当普通透视照片重建，产出的世界和场景对不上。
  const panoProbeRef = useRef(new Map<string, boolean>());
  const threeDImageUrl = uploadedFileUrls(slotData.threeDImage || [])[0] || "";
  useEffect(() => {
    if (!threeDImageUrl || panoProbeRef.current.has(threeDImageUrl)) return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (cancelled || !probe.naturalHeight) return;
      const ratio = probe.naturalWidth / probe.naturalHeight;
      panoProbeRef.current.set(threeDImageUrl, ratio >= 1.9 && ratio <= 2.1);
    };
    probe.src = threeDImageUrl;
    return () => { cancelled = true; };
  }, [threeDImageUrl]);

  // Design-preview simulation still uses the legacy single foreground timers.
  const ticksRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only invalidates the local design-preview simulation now; real backend runs
  // have independent controls in runControlsRef.
  const runIdRef = useRef(0);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const runControlsRef = useRef<Map<string, ConcurrentRunControl>>(new Map());
  const pendingCreateIdsRef = useRef<Set<string>>(new Set());
  const createSeqRef = useRef(0);

  const releaseSubmissionGate = useCallback(() => {
    const gate = submissionGateRef.current;
    if (!gate) return;
    if (submissionReleaseTimerRef.current) clearTimeout(submissionReleaseTimerRef.current);
    if (!mountedRef.current) {
      gate.unlock();
      submissionReleaseTimerRef.current = null;
      return;
    }
    const unlock = () => {
      gate.unlock();
      submissionReleaseTimerRef.current = null;
      setSubmitting(false);
    };
    const delay = gate.releaseDelay();
    if (delay > 0) {
      submissionReleaseTimerRef.current = setTimeout(unlock, delay);
    } else {
      unlock();
    }
  }, []);

  /* Poll every accepted task independently. Every task also owns a separate
     feed entry; a newer submission must never replace an older loading card. */
  const driveRun = useCallback(
    (run: ActiveRun, makeForeground = true, replaceTaskId?: string) => {
      const currentUserId = useAuthStore.getState().user?.id ?? "";
      if (!run.ownerUserId || currentUserId !== run.ownerUserId) return;

      const { taskId, prompt: p, model: mdl, ratio: r, spec, count: n, isVid, label, hues } = run;
      const kind: ArtworkType = run.kind ?? (isVid ? "video" : "image");
      // Older persisted snapshots may lack a valid timestamp. Normalize once so
      // feed sorting, timeout accounting and completion timestamps cannot become
      // NaN/Invalid Date and strand an otherwise successful task in polling.
      const startedAt = Number.isFinite(run.startedAt) && run.startedAt > 0
        ? run.startedAt
        : Date.now();
      const previous = runControlsRef.current.get(taskId);
      if (previous) {
        previous.ticks.forEach((timer) => clearInterval(timer));
        if (previous.poll) clearTimeout(previous.poll);
      }
      const control: ConcurrentRunControl = { token: Symbol(taskId), ticks: [], poll: null };
      runControlsRef.current.set(taskId, control);
      const isActive = () => runControlsRef.current.get(taskId)?.token === control.token;
      const isForeground = () => activeRunRef.current?.taskId === taskId;
      const hasOngoingRuns = () =>
        runControlsRef.current.size > 0 || pendingCreateIdsRef.current.size > 0;

      const newCells: ResultCell[] = hues.map((h, i) => ({ i, hues: h }));
      const PROG_FLOOR = 6;
      const local = new Array(n).fill(PROG_FLOOR);
      if (makeForeground) {
        activeRunRef.current = startedAt === run.startedAt ? run : { ...run, startedAt };
        setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, kind, refThumbs: run.refThumbs, params: run.params });
        setCells(newCells);
        setProgs([...local]);
        setBusy(true);
      }
      setInflightRuns((prev) => upsertInflightRunNewestFirst(
        replaceTaskId ? prev.filter((item) => item.taskId !== replaceTaskId) : prev,
        {
          taskId,
          startedAt,
          phase: "processing",
          meta: { prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, kind, refThumbs: run.refThumbs, params: run.params },
          cells: newCells,
          progs: [...local],
        },
      ));
      setBusy(true);

      // Do not fabricate percentage progress. The previous 500ms timer climbed
      // to 90% even after the backend process had restarted and lost its worker,
      // producing misleading states such as a task frozen forever at 51%.
      // Only authoritative progress returned by /api/ai/tasks/:id updates `local`.

      const clearTimers = () => {
        control.ticks.forEach((timer) => clearInterval(timer));
        control.ticks = [];
        if (control.poll) {
          clearTimeout(control.poll);
          control.poll = null;
        }
      };
      const clearActive = (commit = true) => {
        clearTimers();
        if (isActive()) runControlsRef.current.delete(taskId);
        if (isForeground()) activeRunRef.current = null;
        setInflightRuns((prev) => prev.filter((item) => item.taskId !== taskId));
        setBusy(hasOngoingRuns());
        if (!commit) return;
        removePersistedActiveRun(run);
        if (run.journalScope) {
          void commitAcceptedAiGeneration(run.journalScope, taskId, run.ownerUserId);
        }
      };
      const isValidUrl = (u?: string): u is string =>
        !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));

      const finish = (urls: string[], tracks: MetaTrack[] = [], assets: ThreeDAsset[] = []) => {
        if (!isActive()) return;
        const foreground = isForeground();
        // Suno 一次返回两首：结果多于占位格时按结果数展开。
        const outCells =
          kind === "audio" && urls.length > newCells.length
            ? urls.map(
                (_, i) => newCells[i] ?? { i, hues: newCells[0]?.hues ?? ([0, 80, 200] as MeshHues) },
              )
            : newCells;
        clearActive();
        if (foreground) {
          setProgs(new Array(outCells.length).fill(100));
          setCells(outCells.map((cell) => ({ ...cell, url: urls[cell.i] ?? urls[0] })));
          setBusy(hasOngoingRuns());
        }
        const runKey = `task-${taskId}`;
        // Feed order is task-creation order, not provider completion order. An
        // older slow task finishing last must not jump above a newer run.
        const ts = new Date(startedAt).toISOString();
        const built = outCells.map((cell) => ({
          id: nextHistId(),
          run: runKey,
          ts,
          ratio: r,
          hues: cell.hues,
          type: kind,
          title: tracks[cell.i]?.title || p || mdl,
          prompt: p,
          model: mdl,
          url: urls[cell.i] ?? urls[0],
          status: "success" as const,
          ...(kind === "3d"
            ? {
                assets,
                previewImageUrl: assets.find((asset) => asset.previewImageUrl)?.previewImageUrl,
              }
            : {}),
          clipId: tracks[cell.i]?.clipId || undefined,
          trackTitle: tracks[cell.i]?.title || undefined,
          trackCover: tracks[cell.i]?.coverUrl || undefined,
          trackDur: tracks[cell.i]?.duration || undefined,
          params: run.params,
        }));
        setHist((prev) => (prev.some((item) => item.run === runKey) ? prev : [...built, ...prev]));
        void refreshBalance();
        toast.success(
          kind === "audio"
            ? "生成完成 · 点击播放试听"
            : kind === "video"
              ? "视频生成完成 · 点击播放查看"
              : kind === "3d"
                ? "3D 模型生成完成 · 可预览并下载模型文件"
              : "生成完成 · 点击图片放大查看",
        );
      };

      const fail = (msg?: string) => {
        if (!isActive()) return;
        const foreground = isForeground();
        const errorMsg = msg?.trim() || "生成服务未返回具体失败原因，请稍后重试";
        const runKey = `task-${taskId}`;
        const failedItem: HistItem = {
          id: nextHistId(),
          run: runKey,
          ts: new Date(startedAt).toISOString(),
          ratio: r,
          hues: newCells[0]?.hues ?? ([0, 80, 200] as MeshHues),
          type: kind,
          title: p || mdl,
          prompt: p,
          model: mdl,
          status: "failed",
          errorMsg,
          params: run.params,
        };
        clearActive();
        setHist((prev) => (prev.some((item) => item.run === runKey) ? prev : [failedItem, ...prev]));
        if (foreground) setBusy(hasOngoingRuns());
        void refreshBalance();
        toast.error(errorMsg);
      };

      let transientFailures = 0;
      let reconnectNoticeShown = false;
      let deadlineNoticeShown = false;
      const poll = async () => {
        if (!isActive()) return;
        if ((useAuthStore.getState().user?.id ?? "") !== run.ownerUserId) {
          const foreground = isForeground();
          clearActive(false);
          if (foreground) setBusy(hasOngoingRuns());
          return;
        }
        const maxMs = isVid
          ? 45 * 60 * 1000
          : kind === "3d"
            ? 30 * 60 * 1000
            : kind === "audio"
              ? 12 * 60 * 1000
              : 7 * 60 * 1000;
        const beyondPollingBudget = Date.now() - startedAt > maxMs;
        if (beyondPollingBudget && !deadlineNoticeShown) {
          deadlineNoticeShown = true;
          toast.info("生成时间较长，仍在后台继续确认结果");
        }
        try {
          const res = await aiApi.getTask(taskId);
          if (!isActive()) return;
          if ((useAuthStore.getState().user?.id ?? "") !== run.ownerUserId) {
            const foreground = isForeground();
            clearActive(false);
            if (foreground) setBusy(hasOngoingRuns());
            return;
          }
          if (!res.success || !res.data) {
            if (res.code === 403 || res.code === 404) {
              fail(res.message);
              return;
            }
            transientFailures += 1;
            if (!reconnectNoticeShown) {
              reconnectNoticeShown = true;
              toast.info("连接暂时中断，正在自动恢复生成状态");
            }
            const retryDelay = Math.min(15_000, 1500 * (2 ** Math.min(3, transientFailures - 1)));
            control.poll = setTimeout(poll, beyondPollingBudget ? Math.max(10_000, retryDelay) : retryDelay);
            return;
          }
          transientFailures = 0;
          const task = res.data;
          if (task.status === AiTaskStatus.SUCCESS) {
            let meta: Record<string, unknown> = {};
            if (typeof task.resultMeta === "string") {
              try {
                meta = JSON.parse(task.resultMeta) || {};
              } catch {
                meta = {};
              }
            } else if (task.resultMeta && typeof task.resultMeta === "object") {
              meta = task.resultMeta as Record<string, unknown>;
            }
            const rawUrls = meta.urls;
            const urls = Array.isArray(rawUrls) ? rawUrls.filter(isValidUrl) : [];
            const all = urls.length ? urls : isValidUrl(task.resultUrl) ? [task.resultUrl] : [];
            if (!all.length) {
              fail("生成结果无效，可能未配置 AI 供应商");
              return;
            }
            finish(all, tracksFromMeta(meta), threeDAssetsFromMeta(meta));
          } else if (task.status === AiTaskStatus.FAILED) {
            fail(task.errorMsg);
          } else if (task.status === AiTaskStatus.CANCELLED) {
            const foreground = isForeground();
            clearActive();
            if (foreground) setBusy(hasOngoingRuns());
            void refreshBalance();
          } else {
            if (typeof task.progress === "number") {
              const progress = Math.min(95, Math.max(PROG_FLOOR, task.progress));
              for (let i = 0; i < n; i++) local[i] = Math.max(local[i], progress);
              setInflightRuns((prev) => prev.map((item) =>
                item.taskId === taskId ? { ...item, progs: [...local] } : item,
              ));
              if (isForeground()) setProgs([...local]);
            }
            control.poll = setTimeout(poll, beyondPollingBudget ? 10_000 : 1500);
          }
        } catch {
          if (!isActive()) return;
          transientFailures += 1;
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("连接暂时中断，正在自动恢复生成状态");
          }
          const retryDelay = Math.min(15_000, 1500 * (2 ** Math.min(3, transientFailures - 1)));
          control.poll = setTimeout(poll, retryDelay);
        }
      };
      void poll();
    },
    [refreshBalance, setHist],
  );

  // Release the synchronous in-flight latch whenever a run settles (busy → false).
  // This single effect covers every setBusy(false) path (driveRun finish/fail/
  // cancelled, startGeneration failure, the simulation branch); paths that set the
  // latch but never start a run (a thrown one-click op) clear it themselves.
  useEffect(() => {
    if (!busy) {
      genInFlightRef.current = false;
      // 结算即刷新余额：成功已扣减、失败/取消已退款，都以后端为准。
      refreshBalance();
    }
  }, [busy, refreshBalance]);

  // Tear down all timers on unmount. Beyond the progress intervals, this must
  // also clear the self-rescheduling poll timeout and bump runIdRef — otherwise
  // `poll` keeps re-arming after navigation, hits getTask forever, and on
  // completion runs setState on an unmounted component + pops a toast on whatever
  // page the user is now on.
  useEffect(() => {
    mountedRef.current = true;
    const runControls = runControlsRef.current;
    const pendingCreateIds = pendingCreateIdsRef.current;
    return () => {
      mountedRef.current = false;
      ticksRef.current.forEach((t) => clearInterval(t));
      ticksRef.current = [];
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      for (const control of runControls.values()) {
        control.ticks.forEach((timer) => clearInterval(timer));
        if (control.poll) clearTimeout(control.poll);
      }
      runControls.clear();
      pendingCreateIds.clear();
      if (submissionReleaseTimerRef.current) clearTimeout(submissionReleaseTimerRef.current);
      submissionGateRef.current?.unlock();
      runIdRef.current += 1; // invalidate any in-flight poll
    };
  }, []);

  /* Create a backend task and hand the progress UI + polling to driveRun. Shared
     by the panel generate() and the one-click per-result edit ops, so both go
     through the exact same task-create → persist → drive path. */
  const startGeneration = useCallback(
    async (args: {
      handler: string;
      modelId: string;
      input: Record<string, unknown>;
      meta: Omit<ActiveRun, "taskId" | "startedAt" | "journalScope" | "ownerUserId">;
    }) => {
      const createSeq = (createSeqRef.current += 1);
      const clientRequestId = studioClientRequestID();
      const optimisticTaskId = `pending:${clientRequestId}`;
      const startedAt = Date.now();
      const optimisticCells: ResultCell[] = args.meta.hues.map((hues, i) => ({ i, hues }));
      pendingCreateIdsRef.current.add(optimisticTaskId);
      setInflightRuns((prev) => upsertInflightRunNewestFirst(prev, {
        taskId: optimisticTaskId,
        clientRequestId,
        startedAt,
        phase: "submitting",
        meta: args.meta,
        cells: optimisticCells,
        progs: new Array(optimisticCells.length).fill(2),
      }));
      // A rejected newer click must not hide an older task that is still the
      // foreground run. This matters most when the server rejects click N+1
      // because the configured concurrency cap is already full.
      const settleLatestCreate = () => {
        pendingCreateIdsRef.current.delete(optimisticTaskId);
        setInflightRuns((prev) => prev.filter((item) => item.taskId !== optimisticTaskId));
        if (createSeqRef.current === createSeq) {
          setBusy(runControlsRef.current.size > 0 || pendingCreateIdsRef.current.size > 0);
        }
      };
      setBusy(true);
      try {
        if (!(await ensureSession())) {
          settleLatestCreate();
          return;
        }
        const ownerUserId = useAuthStore.getState().user?.id ?? "";
        if (!ownerUserId) {
          settleLatestCreate();
          toast.error("无法确认当前账号，生成任务尚未启动，请刷新后重试");
          return;
        }
        const journalScope = `studio:${args.meta.kind ?? (args.meta.isVid ? "video" : "image")}`;
        const createInput = {
          handler: args.handler,
          modelId: args.modelId,
          ...(typeof args.input.skillId === "string"
            ? { entryPoint: "studio" as const, targetType: args.meta.kind }
            : {}),
          clientRequestId,
          input: args.input,
        };
        let res2: Awaited<ReturnType<typeof aiApi.generateIdempotent>>;
        let reconnectNoticeShown = false;
        for (;;) {
          res2 = await aiApi.generateIdempotent(createInput, journalScope, {
            requireDurableJournal: true,
            retainAccepted: true,
            dedupeActivePayload: true,
            recovery: args.meta,
            ownerUserId,
          });
          if (res2.success && res2.data?.id) break;
          if (!isAmbiguousAiCreateCode(res2.code)) {
            settleLatestCreate();
            toast.error(res2.message || "生成请求失败");
            return;
          }
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("生成请求正在确认中，请保持页面打开");
          }
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
        const run: ActiveRun = {
          taskId: res2.data.id,
          ownerUserId,
          journalScope,
          ...args.meta,
          startedAt,
        };
        pendingCreateIdsRef.current.delete(optimisticTaskId);
        void refreshBalance();
        if (res2.reusedExisting && runControlsRef.current.has(run.taskId)) {
          setInflightRuns((prev) => prev.filter((item) => item.taskId !== optimisticTaskId));
          setBusy(true);
          toast.info("相同任务已在生成中，已为你定位到现有任务");
          return;
        }
        const makeForeground = createSeqRef.current === createSeq;
        if (!makeForeground) {
          // A newer click already owns the foreground pointer. This task stays
          // durable in its accepted journal and is polled independently.
        } else if (persistActiveRun(run)) {
          // Keep the accepted journal as a second pointer until terminal. A
          // single ACTIVE_RUN_KEY can be overwritten by another Studio tab;
          // retaining both prevents the older paid task from becoming hidden.
        } else {
          // The accepted journal still owns recovery. This should only be
          // reachable if storage was revoked between preflight and response.
          toast.info("任务已启动，请保持当前页面打开以等待结果");
        }
        if (res2.reusedExisting) {
          toast.info("相同任务已在生成中，已恢复现有任务");
        }
        driveRun(run, makeForeground, optimisticTaskId);
      } catch {
        settleLatestCreate();
        toast.error("网络错误");
      }
    },
    [ensureSession, driveRun, refreshBalance],
  );

  /* One-click per-result edit op (移除背景 / 物体移除 / 高清放大 / 扩图). Fires a
     real generation on the clicked image with a fixed backend handler — the
     server owns the edit instruction, so the user types nothing. The op always
     runs on an image-edit model (resolved independently of the current panel
     model, which may be a video model), and 高清放大 prefers a 4K-capable one. */
  const oneClickEdit = useCallback(
    async (op: string, imageUrl: string, label: string) => {
      if (recoveringRuns) {
        toast.info("正在恢复生成任务，请稍候…");
        return;
      }
      if (busy || genInFlightRef.current || submissionGateRef.current?.isLocked()) {
        toast.info("正在生成中，请稍候…");
        return;
      }
      const handler = EDIT_OP_HANDLER[op];
      if (!handler || !imageUrl) {
        toast.info("该结果暂无可用图片");
        return;
      }
      // latch synchronously, before the awaits below, so a rapid double-click
      // can't slip a second task through (busy is only set later, inside
      // startGeneration). Cleared on every exit that doesn't hand off to a run.
      genInFlightRef.current = true;
      try {
        await ensureSession();
        // resolve an image-edit-capable model (independent of the current panel
        // type, since the panel may be on 视频 while editing an image result).
        const r = await marketApi.studioModels("image");
        const models = (r.success && r.data ? r.data : []) as StudioModelVO[];
        const editable = models.filter((m) => {
          const c = m.config;
          return (c?.operations?.includes("edits") ?? false) || (c?.modes?.includes("i2i") ?? false);
        });
        const pool = editable.length ? editable : models;
        const is4k = (m: StudioModelVO) =>
          /4k/i.test(m.modelKey || "") || /4k|4K/.test(m.name);
        let pick: StudioModelVO | undefined;
        if (op === "hd") {
          pick = pool.find(is4k) ?? pool.find((m) => model === m.name) ?? pool[0];
        } else {
          pick =
            pool.find((m) => m.name === model) ??
            pool.find((m) => /nano-banana-2$/.test(m.modelKey || "")) ??
            pool.find((m) => /gpt-image-2/.test(m.modelKey || "")) ??
            pool[0];
        }
        const modelId = pick?.modelKey || pick?.id || "";
        if (!modelId) {
          genInFlightRef.current = false;
          toast.error("没有可用的图像编辑模型");
          return;
        }
        // 源图真实比例：扩图请求不带比例时上游按模型默认画布出图，横向图会被
        // 扩成竖图（用户反馈"扩图改比例"）。量出源图宽高吸附到所选模型支持的
        // 档位随请求下发；其余编辑操作上游本就跟随源图尺寸，强行吸附反而会把
        // 非标准比例（如 2:1 长图）改掉，故只用于占位卡形状。测量失败回退原行为。
        const sourceSize = await measureImageSize(imageUrl);
        const ratioPool = pick?.config?.ratios?.length ? pick.config.ratios : RATIOS;
        const snappedRatio = sourceSize ? nearestAspectRatio(sourceSize.width, sourceSize.height, ratioPool) : null;
        const expandRatio = op === "expand" ? snappedRatio : null;
        // input carries only the source image (+ a human label under prompt for
        // history display; the backend overrides it with the engineered prompt)
        // and, for 高清放大, the 4K resolution hint.
        const input: Record<string, unknown> = {
          imageList: [imageUrl],
          sourceImage: imageUrl,
          prompt: label,
          ...(op === "hd" ? { resolution: "4k", clarity: "4k", quality: "high" } : {}),
          ...(expandRatio ? { aspectRatio: expandRatio, aspect_ratio: expandRatio, ratio: expandRatio } : {}),
        };
        const hsh = promptHue(imageUrl);
        const hues: MeshHues[] = [[hsh, (hsh + 80) % 360, (hsh + 200) % 360]];
        // a one-click edit is server-driven with no panel params, so clear the
        // last-run snapshot: the result's 再次生成 / 重新编辑 foot actions must not
        // replay the previous (unrelated) panel run.
        lastRunRef.current = null;
        await startGeneration({
          handler,
          modelId,
          input,
          meta: {
            prompt: label,
            model: pick?.name || model,
            // 占位卡形状跟随源图（编辑结果与源图同比例），量不出时才退回上次面板值
            ratio: snappedRatio ?? runMeta?.ratio ?? "1:1",
            spec: label,
            count: 1,
            isVid: false,
            label,
            hues,
            refThumbs: [imageUrl],
          },
        });
      } catch {
        genInFlightRef.current = false;
        toast.error("网络错误，请重试");
      }
    },
    [busy, ensureSession, model, recoveringRuns, runMeta, startGeneration],
  );

  /* ── generation ───────────────────────────────────────────────────────────
     Calls the real backend (/api/ai/generate → poll /api/ai/tasks/:id) when a
     real studio model is selected; falls back to the design-preview simulation
     only when no backend model is available (studioList empty). */

  const generate = useCallback(async (options?: { requireBackendModel?: boolean; expectedModelId?: string }) => {
    if (recoveringRuns) {
      toast.info("正在恢复生成任务，请稍候…");
      return;
    }
    const selectedStudio = studioList.find((item) => item.name === model) ?? null;
    if (options?.expectedModelId && selectedStudio?.id !== options.expectedModelId) {
      toast.info("历史模型目录已变化，请确认当前模型后重新生成");
      return;
    }
    const selectedBackendModelId = selectedStudio?.modelKey || selectedStudio?.id || "";
    const isWorld3D = is3D && (
      selectedStudio?.config?.threeDKind === "world"
      || selectedStudio?.config?.provider?.toLowerCase() === "worldlabs"
    );
    const activeSlots = (UPLOADS[tool] ?? []).filter(
      (slot) => tool !== "ref" || supportsOmniReference(selectedStudio?.config, slot.type),
    );
    const activeSlotData = Object.fromEntries(
      activeSlots.map((slot) => [slot.k, slotData[slot.k] ?? []]),
    ) as SlotData;
    if (is3D && !selectedBackendModelId) {
      toast.error("暂无可用的 3D 模型，请先在模型管理上架并启用模型");
      return;
    }
    if (options?.requireBackendModel && !selectedBackendModelId) {
      toast.info("历史模型当前不可用，已停止重新生成");
      return;
    }
    // 图片类 3D 与 prompt 互斥；切换页签后保留在面板 state 里的旧提示词
    // 既不发送，也不写入本轮历史。
    const p = !isWorld3D && (tool === "i2_3d" || tool === "mv2_3d") ? "" : prompt.trim();
    // 引用类模式的素材校验优先于提示词，两者都为空时优先说明当前
    // 模式必须上传什么；且只检查当前模型真正启用的槽位。
    const referenceIssue = studioReferenceIssue(tool, activeSlotData, activeSlots.length);
    if (referenceIssue) {
      if (referenceIssue.severity === "error") toast.error(referenceIssue.message);
      else toast.info(referenceIssue.message);
      if (referenceIssue.markRequired) {
        markRequiredField("#dropFiles");
      }
      return;
    }
    // 音乐创作模式互斥（对齐上游 API）：灵感=只看描述;自定义=歌词必填、描述不发;
    // 延长/翻唱=原曲 clip 必选、歌词选填。旧版"风格需搭配歌词"歧义由模式结构消除。
    const musicCustom = isAudio && !isSfx && musicMode === "custom";
    const musicTask = isAudio && !isSfx && (musicMode === "extend" || musicMode === "cover")
      ? musicMode
      : "";
    const audLyrics = isAudio && !isSfx && musicMode !== "inspire" ? lyrics.trim() : "";
    if (musicCustom && !audLyrics) {
      toast.info("自定义歌词模式需先填写歌词 ✦");
      markRequiredField("#fieldLyrics");
      return;
    }
    if (musicTask && !sourceClipId) {
      toast.info(musicTask === "extend" ? "延长模式需先选择原曲 ✦" : "翻唱模式需先选择原曲 ✦");
      markRequiredField("#fieldSourceClip");
      return;
    }
    const inputOnly3D = is3D && (tool === "i2_3d" || tool === "mv2_3d");
    if (!musicTask && !p && !audLyrics && !inputOnly3D) {
      toast.info(isAudio ? "先写一句音乐描述 ✦" : "先写一句提示词吧 ✦");
      markRequiredField(".ws-promptbox");
      promptRef.current?.focus();
      return;
    }

    // reference assets from the upload slots (real URLs from 本地上传 / 资产库).
    const slotUrls = (key: string) => uploadedFileUrls(slotData[key] || []);
    const imageRefs = tool === "ref" && !supportsOmniReference(selectedStudio?.config, "image")
      ? []
      : tool === "i2v"
      ? slotUrls("first")
      : tool === "i2_3d"
        ? slotUrls("threeDImage")
        : slotUrls("img");
    const firstFrame = slotUrls("first")[0];
    const lastFrame = slotUrls("last")[0];
    const multiViewImages: ThreeDViewImage[] = tool === "mv2_3d"
      ? THREE_D_VIEW_SLOTS.flatMap(({ key, viewType }) => {
          const viewImageUrl = slotUrls(key)[0];
          return viewImageUrl ? [{ viewType, viewImageUrl }] : [];
        })
      : [];
    const multiViewLimit = threeDMultiViewLimit(selectedStudio?.config);
    if (multiViewImages.length > multiViewLimit) {
      toast.info(`多视图最多上传 ${multiViewLimit} 张图片，请移除多余图片后重试`);
      markRequiredField("#dropFiles");
      return;
    }
    const referenceSizeIssue = threeDReferenceSizeIssue(selectedStudio?.config, tool, activeSlotData);
    if (referenceSizeIssue) {
      toast.info(referenceSizeIssue);
      markRequiredField("#dropFiles");
      return;
    }
    // 全能参考 (ref) accepts image / video / audio references — any one is enough.
    const vidRefs = tool === "ref" && supportsOmniReference(selectedStudio?.config, "video")
      ? slotUrls("video")
      : [];
    const audRefs = tool === "ref" && supportsOmniReference(selectedStudio?.config, "audio")
      ? slotUrls("audio")
      : [];
    // 数量以后台模型配置为准：素材跨模型切换保留、历史回填都可能超出当前模型的
    // 上限，上传时的槽位校验挡不住（服务端 validateReferenceCountInput 同源兜底）。
    const countIssue = studioReferenceCountIssue(selectedStudio?.config, tool, {
      image: imageRefs.length,
      video: vidRefs.length,
      audio: audRefs.length,
    });
    if (countIssue) {
      toast.info(countIssue);
      markRequiredField("#dropFiles");
      return;
    }
    // 上传/资产选择时已校验；这里兜底历史恢复、旧草稿和跨模型保留的素材。
    // 已记录宽高的素材同步复检，旧素材才异步读取，不给正常新上传增加等待。
    const videoReferenceFiles = tool === "i2v"
      ? (slotData.first ?? []).map((file) => ({ file, label: "首帧参考图" }))
      : tool === "flf"
        ? [
            ...(slotData.first ?? []).map((file) => ({ file, label: "首帧参考图" })),
            ...(slotData.last ?? []).map((file) => ({ file, label: "尾帧参考图" })),
          ]
        : tool === "ref" && supportsOmniReference(selectedStudio?.config, "image")
          ? (slotData.img ?? []).map((file, index) => ({ file, label: `参考图 ${index + 1}` }))
          : [];
    const usableVideoReferenceFiles = videoReferenceFiles.filter(({ file }) => !!file.url?.trim() && !file.uploading);
    for (const { file, label } of usableVideoReferenceFiles) {
      if (!file.width || !file.height) continue;
      const aspectIssue = videoReferenceImageAspectIssue(file.width, file.height, file.n || label);
      if (aspectIssue) {
        toast.error(aspectIssue);
        markRequiredField("#dropFiles");
        return;
      }
    }
    const unknownVideoReferenceFiles = usableVideoReferenceFiles.filter(({ file }) => !file.width || !file.height);
    if (unknownVideoReferenceFiles.length > 0) {
      if (referenceValidationRef.current) {
        toast.info("正在检查参考图片，请稍候…");
        return;
      }
      referenceValidationRef.current = true;
      setValidatingReferences(true);
      const validationSignature = generationValidationSignature;
      let measured: Array<{ width: number; height: number } | null> = [];
      try {
        measured = await Promise.all(
          unknownVideoReferenceFiles.map(({ file }) => {
            const source = file.url!.trim();
            return measureImageSize(ossDisplayUrl(source, 96) ?? source);
          }),
        );
      } finally {
        referenceValidationRef.current = false;
        if (mountedRef.current) setValidatingReferences(false);
      }
      if (!mountedRef.current) return;
      if (generationValidationSignatureRef.current !== validationSignature) {
        toast.info("生成参数已变化，请重新点击生成");
        return;
      }
      for (let index = 0; index < unknownVideoReferenceFiles.length; index++) {
        const { file, label } = unknownVideoReferenceFiles[index];
        const dimensions = measured[index];
        const aspectIssue = dimensions
          ? videoReferenceImageAspectIssue(dimensions.width, dimensions.height, file.n || label)
          : `${file.n || label}：无法读取有效尺寸，请重新选择图片`;
        if (aspectIssue) {
          toast.error(aspectIssue);
          markRequiredField("#dropFiles");
          return;
        }
      }
    }
    const needsRef = activeSlots.length > 0;
    const hasAnyRef =
      imageRefs.length > 0 || !!firstFrame || !!lastFrame || vidRefs.length > 0 || audRefs.length > 0 || multiViewImages.length > 0;
    if (needsRef && !hasAnyRef) {
      toast.info(
        tool === "ref"
          ? "请先上传参考素材（图片 / 视频 / 音频）"
          : tool === "mv2_3d"
            ? "请至少上传一个视角图片"
            : "请先上传参考图片",
      );
      markRequiredField("#dropFiles");
      return;
    }
    const refInput: Record<string, unknown> = {};
    if (imageRefs.length) {
      if (tool === "i2_3d") {
        refInput.imageUrl = imageRefs[0];
        if (isWorld3D && panoProbeRef.current.get(imageRefs[0])) refInput.isPano = true;
      } else {
        refInput.imageList = imageRefs;
        refInput.sourceImage = imageRefs[0];
        if (imageRefs.length > 1) refInput.references = imageRefs.slice(1);
      }
    }
    if (tool === "flf") {
      if (firstFrame) refInput.firstFrame = firstFrame;
      if (lastFrame) refInput.lastFrame = lastFrame;
    }
    if (tool === "ref") {
      if (vidRefs.length) refInput.videoReferences = vidRefs;
      if (audRefs.length) refInput.audioReferences = audRefs;
    }
    if (multiViewImages.length) refInput.multiViewImages = multiViewImages;

    // All validation passed. Acquire synchronously before any state update or
    // request so two click events cannot create two paid tasks. The gate is only
    // held through task creation (+ a short double-click floor), preserving
    // intentional concurrent generations after the first task is accepted.
    const submissionGate = submissionGateRef.current;
    if (genInFlightRef.current || !submissionGate || !submissionGate.tryAcquire()) {
      toast.info("生成请求正在提交，请勿重复点击");
      return;
    }
    if (refInput.isPano === true) {
      // 提示放在防重复闸门之后，双击不会弹两次。
      toast.info("参考图为 2:1 全景比例，将按 360° 全景重建");
    }
    if (submissionReleaseTimerRef.current) {
      clearTimeout(submissionReleaseTimerRef.current);
      submissionReleaseTimerRef.current = null;
    }
    setSubmitting(true);
    setBusy(true);

    const isVid = TOOLS[tool].mode === "t2v";
    // History restore and skill defaults can write a stale duration after the
    // model-config effect has already run. Treat the current catalog options as
    // authoritative again at submission time so only an admin-configured value
    // reaches the API.
    const generationDur = durOpts.includes(dur) ? dur : durOpts[0] ?? "";
    // video/audio tools always produce a single result; only image batches honor
    // 生成数量 (the count slider is image-only, but `count` persists across type
    // switches — without this a leftover count>1 would spawn N duplicate cells).
    const n = isVid || isAudio || is3D ? 1 : count;
    const label = TOOLS[tool].label;
    const r = isAudio || is3D ? "" : ratio; // 音频/3D 无画面比例
    const mdl = model;
    const hsh = promptHue(p || audLyrics);
    const spec = isAudio
      ? ""
      : is3D
        ? isWorld3D
          ? "SPZ 场景 · 碰撞 GLB · 全景图"
          : `${enablePbr ? "PBR" : "标准材质"} · ${faceCount.toLocaleString()} 面 · ${resultFormat || "OBJ + GLB"}`
        : isVid
          ? `${r} · ${res} · ${generationDur}`
          : `${r} · ${imgRes}`;
    const hues: MeshHues[] = Array.from(
      { length: n },
      (_, i) => [hsh + i * 36, hsh + i * 36 + 80, hsh + i * 36 + 200] as MeshHues,
    );
    const refThumbs = refThumbsForRun(activeSlotData, hsh);
    const presetSkill =
      skill && skillKindOf(skill) === "preset" && skillSupportsOutput(skill, curType)
        ? skill
        : null;

    // snapshot the exact settings of this run for 重新编辑 / 再次生成.
    lastRunRef.current = {
      prompt: p, model: mdl, ...(selectedStudio?.id ? { modelId: selectedStudio.id } : {}),
      tool, curType, ratio: r, imgRes, res, dur: generationDur, quality, count: n,
      ...(presetSkill ? { skill: { id: presetSkill.id, title: presetSkill.title } } : {}),
      imageRefs, firstFrame, lastFrame, videoRefs: vidRefs, audioRefs: audRefs,
      ...(is3D && !isWorld3D
        ? { multiViewImages, enablePbr, faceCount, generateType, resultFormat }
        : is3D ? { multiViewImages } : {}),
      ...(isAudio && !isSfx
        ? {
            lyrics: audLyrics || undefined,
            songStyle: songStyle.trim() || undefined,
            songTitle: songTitle.trim() || undefined,
            instrumental: instrumental || undefined,
            musicMode,
            sourceClipId: musicTask ? sourceClipId : undefined,
            sourceIsUpload: musicTask && sourceIsUpload ? true : undefined,
            continueAt:
              musicTask === "extend" ? parseInt(continueAt, 10) || undefined : undefined,
          }
        : {}),
    };

    setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, kind: curType, refThumbs, params: lastRunRef.current ?? undefined });
    setCells(hues.map((h, i) => ({ i, hues: h })));
    setProgs(new Array(n).fill(0));

    // clear any stragglers from a previous run + invalidate its poll.
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    // invalidate any in-flight poll from a previous run (startGeneration/driveRun
    // each take their own run id from here).
    runIdRef.current += 1;

    const modelId = selectedBackendModelId;

    // ── design-preview simulation (no backend model configured) ───────────
    if (!modelId) {
      const simRun = `sim-${Date.now()}`;
      const simTs = new Date().toISOString();
      const local = new Array(n).fill(0);
      const doneLocal = new Array(n).fill(false);
      let doneCountLocal = 0;
      hues.forEach((hu, i) => {
        const speed = 1.4 + Math.random() * 1.2;
        const tick = setInterval(() => {
          local[i] = Math.min(100, local[i] + speed + Math.random() * 3);
          setProgs([...local]);
          if (local[i] >= 100) {
            clearInterval(tick);
            if (doneLocal[i]) return;
            doneLocal[i] = true;
            doneCountLocal += 1;
            pushHistory({
              run: simRun,
              ts: simTs,
              ratio: r,
              hues: hu,
              type: isAudio ? "audio" : isVid ? "video" : "image",
              title: p,
              prompt: p,
              model: mdl,
              params: lastRunRef.current ?? undefined,
            });
            if (doneCountLocal >= n) {
              setBusy(false);
              toast.success("生成完成 · 点击图片放大查看");
            }
          }
        }, 90 + i * 40);
        ticksRef.current.push(tick);
      });
      releaseSubmissionGate();
      return;
    }

    // ── real generation: build the input, then hand off to startGeneration
    // (shared task-create → persist → drive path). ────────────────────────
    // 技能:只发 skillId,模板由服务端拼到描述前面(客户端先拼会污染落库的 input,
    // 作品标题/重新编辑读到的就全是模板开头)
    const genPrompt = p;
    const skillInput = presetSkill ? { skillId: presetSkill.id } : {};
    const input: Record<string, unknown> = is3D
      ? {
          ...((tool !== "i2_3d" || isWorld3D) && p ? { prompt: genPrompt } : {}),
          ...refInput,
          ...(!isWorld3D ? {
            enablePbr,
            faceCount,
            generateType,
            ...(resultFormat ? { resultFormat } : {}),
          } : {}),
        }
      : isAudio
      ? {
          // 音频：灵感模式只发描述；自定义歌词模式只发歌词/风格/歌名（描述不发，
          // 上游有 lyrics 时本就忽略 input）；延长/翻唱经 extras 传 task 与原曲
          // clip_id（此组合上游不做 tags 歧义校验）；SFX 卡只吃描述。
          ...skillInput,
          ...(p && !musicCustom && !musicTask ? { prompt: genPrompt } : {}),
          ...(audLyrics ? { lyrics: audLyrics } : {}),
          ...((audLyrics || musicTask) && songStyle.trim() ? { tags: songStyle.trim() } : {}),
          ...((audLyrics || musicTask) && songTitle.trim() ? { title: songTitle.trim() } : {}),
          ...(!isSfx && instrumental ? { makeInstrumental: true } : {}),
          ...(musicTask
            ? {
                extras:
                  musicTask === "extend"
                    ? {
                        // 上传登记的本地音频延长走 upload_extend(上游对两种来源分开建模)
                        task: sourceIsUpload ? "upload_extend" : "extend",
                        continue_clip_id: sourceClipId,
                        ...(parseInt(continueAt, 10) > 0
                          ? { continue_at: parseInt(continueAt, 10) }
                          : {}),
                      }
                    : { task: "cover", cover_clip_id: sourceClipId },
              }
            : {}),
        }
      : {
          prompt: genPrompt,
          ...skillInput,
          ...refInput,
          ...(ratioOpts.length ? { aspectRatio: r, aspect_ratio: r, ratio: r } : {}),
          ...(isVid
            ? {
                ...(resOpts.length ? { resolution: res } : {}),
                ...(generationDur ? { duration: generationDur } : {}),
              }
            : {
                ...(resOpts.length ? { clarity: imgRes, resolution: imgRes } : {}),
                ...(qualOpts.length ? { quality } : {}),
              }),
          ...(n > 1 ? { batchCount: n } : {}),
        };
    void startGeneration({
      handler: TOOL_TO_HANDLER[tool],
      modelId,
      input,
      meta: {
        prompt: p,
        model: mdl,
        ratio: r,
        spec,
        count: n,
        isVid,
        kind: curType,
        label,
        hues,
        refThumbs,
        params: lastRunRef.current ?? undefined,
      },
    }).finally(releaseSubmissionGate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, recoveringRuns, prompt, count, tool, curType, ratio, model, res, dur, imgRes, quality, musicMode, sourceClipId, sourceIsUpload, continueAt, lyrics, songStyle, songTitle, instrumental, enablePbr, faceCount, generateType, resultFormat, slotData, studioList, ratioOpts, resOpts, durOpts, qualOpts, pushHistory, startGeneration, skill, isAudio, isSfx, is3D, promptRef, releaseSubmissionGate]);

  // Refresh-resume has two durable layers. ACTIVE_RUN_KEY is the normal pointer;
  // the accepted-create journal closes the response→ACTIVE_RUN_KEY crash window
  // and can replay an ambiguous create with the original clientRequestId.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- paid submits stay locked until durable recovery is scanned
    setRecoveringRuns(true);
    (async () => {
      try {
        if (!(await ensureSession()) || cancelled) return;
        const ownerUserId = useAuthStore.getState().user?.id ?? "";
        // A paid create must not start or recover until /me has confirmed which
        // account owns its local partition.
        if (!ownerUserId) return;

        const activeKey = activeRunStorageKey(ownerUserId);
        let raw: string | null = null;
        try {
          raw = localStorage.getItem(activeKey);
        } catch {
          raw = null;
        }
        let saved: ActiveRun | null = null;
        try {
          saved = JSON.parse(raw || "null") as ActiveRun | null;
        } catch {
          saved = null;
        }
        // One-release migration for an already-running task written by the old
        // global key. Never assign it by assumption: the authenticated detail
        // endpoint must prove this account owns the task first. A 403 leaves the
        // legacy row untouched so its real owner can migrate it later.
        if (!saved && !raw) {
          let legacyRaw: string | null = null;
          try {
            legacyRaw = localStorage.getItem(ACTIVE_RUN_KEY);
          } catch {
            legacyRaw = null;
          }
          let legacy: Partial<ActiveRun> | null = null;
          try {
            legacy = JSON.parse(legacyRaw || "null") as Partial<ActiveRun> | null;
          } catch {
            legacy = null;
          }
          if (
            legacy &&
            typeof legacy.taskId === "string" &&
            !!legacy.taskId &&
            Array.isArray(legacy.hues)
          ) {
            const ownership = await aiApi.getTask(legacy.taskId);
            if (cancelled) return;
            if (ownership.success && ownership.data) {
              saved = { ...legacy, ownerUserId } as ActiveRun;
              if (persistActiveRun(saved)) {
                try {
                  const latest = JSON.parse(localStorage.getItem(ACTIVE_RUN_KEY) || "null") as Partial<ActiveRun> | null;
                  if (latest?.taskId === saved.taskId) localStorage.removeItem(ACTIVE_RUN_KEY);
                } catch {
                  /* keep the legacy pointer */
                }
              }
            }
          }
        }
        if (
          !saved ||
          saved.ownerUserId !== ownerUserId ||
          typeof saved.taskId !== "string" ||
          !saved.taskId ||
          !Array.isArray(saved.hues)
        ) {
          try {
            if (raw) localStorage.removeItem(activeKey);
          } catch {
            /* ignore */
          }
          saved = null;
        }
        const recoveredTaskIds = new Set<string>();
        if (saved) {
          recoveredTaskIds.add(saved.taskId);
          driveRun(saved);
        }

        for (;;) {
          if (cancelled) return;
          const candidates = STUDIO_GENERATION_SCOPES.flatMap((scope) =>
            recoverableAiGenerations(scope, ownerUserId).map((entry) => ({ scope, entry })),
          )
            .filter(({ entry }) => !entry.taskId || !recoveredTaskIds.has(entry.taskId))
            .sort((left, right) => {
              // Restore accepted tasks first so one ambiguous create cannot hide
              // every newer task that already has a durable backend id.
              if (!!left.entry.taskId !== !!right.entry.taskId) {
                return left.entry.taskId ? -1 : 1;
              }
              return left.entry.updatedAt - right.entry.updatedAt;
            });
          const candidate = candidates[0];
          if (!candidate) return;
          const { scope, entry } = candidate;

          const result = entry.taskId
            ? await aiApi.getTask(entry.taskId)
            : entry.payload
              ? await aiApi.generateIdempotent(
                  { ...entry.payload, clientRequestId: entry.clientRequestId },
                  scope,
                  {
                    requireDurableJournal: true,
                    retainAccepted: true,
                    recovery: entry.recovery,
                    ownerUserId,
                  },
                )
              : null;
          if (cancelled) return;
          if (result?.success && result.data) {
            const run = activeRunFromJournal(scope, entry, result.data, ownerUserId);
            if (!run) {
              await commitAcceptedAiGeneration(scope, result.data.id, ownerUserId);
              continue;
            }
            // ACTIVE_RUN is the single foreground pointer. Accepted journals
            // retain every other task, so an older recovered run must not
            // overwrite a newer pointer merely because it was restored later.
            const makeForeground = !activeRunRef.current || isStudioTaskNewerOrEqual(
              run,
              activeRunRef.current,
            );
            if (makeForeground) persistActiveRun(run);
            recoveredTaskIds.add(run.taskId);
            if (!cancelled) driveRun(run, makeForeground);
            continue;
          }

          if (entry.taskId && result && !isAmbiguousAiCreateCode(result.code)) {
            // Any definitive lookup response that was not a usable task above
            // (403, 404, malformed success, etc.) cannot become recoverable by
            // polling this pointer forever. Retire it and continue with others.
            await commitAcceptedAiGeneration(scope, entry.taskId, ownerUserId);
            continue;
          }
          if (result && !isAmbiguousAiCreateCode(result.code)) {
            // generateIdempotent normally retires definitive creates itself. If
            // durable storage is temporarily unavailable its row remains; wait
            // instead of spinning a tight recovery loop.
            const stillPending = recoverableAiGenerations(scope, ownerUserId).some(
              (row) => row.fingerprint === entry.fingerprint,
            );
            if (!stillPending) continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      } finally {
        if (!cancelled) setRecoveringRuns(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticatedUserId, ensureSession, driveRun]);

  // tear down the current run's intervals + result state (no busy guard).
  const resetRun = useCallback(() => {
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    runIdRef.current += 1; // invalidate any in-flight poll for the previous run
    const active = activeRunRef.current;
    if (active) removePersistedActiveRun(active);
    activeRunRef.current = null;
    setInflightRuns([]);
    setCells([]);
    setProgs([]);
    setRunMeta(null);
  }, []);

  return {
    busy,
    submitting,
    validatingReferences,
    recoveringRuns,
    cells,
    progs,
    runMeta,
    inflightRuns,
    setCells,
    setProgs,
    setRunMeta,
    generate,
    oneClickEdit,
    resetRun,
    lastRunRef,
  };
}
