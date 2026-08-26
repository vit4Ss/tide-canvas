"use client";

import { useCallback, useSyncExternalStore } from "react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { sliceImageGrid } from "@/lib/image-slice";
import {
  useCanvasStore,
  type CanvasNode,
  type CanvasPendingGeneration,
} from "@/stores/use-canvas-store";
import type { AiTaskVO, AiGenerateInput } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import { getImageCardSizeForRatio } from "@/lib/image-card-size";
import { requestCanvasSave } from "@/lib/canvas-save";
import { isAmbiguousAiCreateCode } from "@/lib/ai-generation-idempotency";
import { canvasThreeDAssetsFromMeta } from "@/lib/canvas-three-d";
import {
  matchesCanvasGeneration,
  pendingGenerationIdentity,
} from "@/lib/canvas-generation-guard";

interface GenerateParams {
  nodeId: string;
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
  /** 跨页启动等可恢复流程传入稳定请求号，刷新重放时复用同一后端任务。 */
  clientRequestId?: string;
  /** 上游返回单张 2×2 四宫格(如 Midjourney)：成功后前端切成 4 张独立图并以组图展示 */
  gridOutput?: boolean;
  /** 生成成功回调，参数为结果地址（如全景生成后用于打开 360 查看器） */
  onSuccess?: (resultUrl: string) => void;
}

export type GenerationStartResult =
  | { status: "started"; taskId: string }
  | { status: "rejected" }
  | { status: "ambiguous" };

const POLL_INTERVAL = 2000; // 2 秒轮询
// 后端允许图片上游最多运行 10 分钟，成功后还可能需要约 90 秒把结果转存到自有 OSS。
// 前端必须覆盖完整后端预算，否则会在一个最终成功的任务上提前显示“生成失败”。
const MAX_POLL_TIME = 15 * 60 * 1000;
// 视频后端最多等待 40 分钟；前端正常轮询多留 5 分钟收尾余量，之后只降低
// 轮询频率，不会擅自把仍在服务端执行的任务判失败。
const MAX_POLL_TIME_VIDEO = 45 * 60 * 1000;
const MAX_POLL_TIME_AUDIO = 30 * 60 * 1000;
const MAX_POLL_TIME_3D = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// 画布级轮询单例
//
// 轮询状态是模块级的,不属于任何组件实例:任务的目标节点(nodeId)与发起生成的
// 组件可以不是同一个(全景/多角度/视频重新生成都从 A 节点写入 B 节点),若轮询
// 器活在发起组件里,删掉 A 会连带停掉 B 的轮询。这里按 nodeId→taskId 登记,
// 生命周期只跟画布页面(stopAllGeneration)和节点存活挂钩。
// ---------------------------------------------------------------------------

/** nodeId → taskId；`pending:<requestId>` 表示创建响应尚未确认。 */
const activeTasks = new Map<string, string>();
const pollTimers = new Map<string, NodeJS.Timeout>();
const pendingCreateAttempts = new Map<string, number>();
const pendingCreateNotified = new Set<string>();
const listeners = new Set<() => void>();
/** useSyncExternalStore 快照：每次登记表变化重建，引用变化即触发订阅组件重渲染 */
let activeSnapshot: ReadonlySet<string> = new Set();

function emit() {
  activeSnapshot = new Set(activeTasks.keys());
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return activeSnapshot;
}

function track(nodeId: string, taskId: string) {
  activeTasks.set(nodeId, taskId);
  emit();
}

/** 终态收尾：摘除登记与待触发的 timer */
function finish(nodeId: string, expectedIdentity?: string) {
  if (expectedIdentity && activeTasks.get(nodeId) !== expectedIdentity) return;
  const timer = pollTimers.get(nodeId);
  if (timer) {
    clearTimeout(timer);
    pollTimers.delete(nodeId);
  }
  pendingCreateAttempts.delete(nodeId);
  pendingCreateNotified.delete(nodeId);
  if (activeTasks.delete(nodeId)) emit();
}

/** 离开画布页面时调用：停止全部轮询链。在途的 await 返回后会因登记表比对失败而自行退出。 */
export function stopAllGeneration() {
  pollTimers.forEach((t) => clearTimeout(t));
  pollTimers.clear();
  pendingCreateAttempts.clear();
  pendingCreateNotified.clear();
  if (activeTasks.size > 0) {
    activeTasks.clear();
    emit();
  }
}

function createGenerationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `canvas-gen-${crypto.randomUUID()}`;
  }
  return `canvas-gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pendingMarker(requestId: string) {
  return pendingGenerationIdentity(requestId);
}

function validTaskId(value: unknown): value is string {
  // idgen IDs are positive signed-64-bit decimal strings. A strict shape check
  // prevents damaged legacy canvasData from entering an endless 400 retry loop.
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}

function pendingMatches(node: CanvasNode | undefined, pending: CanvasPendingGeneration) {
  return node?.status === "generating"
    && node.pendingGeneration?.clientRequestId === pending.clientRequestId;
}

function validPendingGeneration(value: unknown): value is CanvasPendingGeneration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<CanvasPendingGeneration>;
  return row.version === 1
    && typeof row.handler === "string" && row.handler.trim() === row.handler && row.handler.length > 0
    && typeof row.modelId === "string" && row.modelId.trim() === row.modelId && row.modelId.length > 0
    && !!row.input && typeof row.input === "object" && !Array.isArray(row.input)
    && typeof row.clientRequestId === "string"
    && row.clientRequestId.trim() === row.clientRequestId
    && row.clientRequestId.length > 0 && row.clientRequestId.length <= 96
    && typeof row.projectId === "string"
    && row.projectId.trim() === row.projectId && row.projectId.length > 0
    && typeof row.createdAt === "number" && Number.isFinite(row.createdAt);
}

function parseAspectRatio(value: unknown): number | null {
  if (typeof value !== "string" || value === "auto") return null;
  const [w, h] = value.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

function imageSizeForAspect(node: CanvasNode, aspectRatio: unknown) {
  const aspect = parseAspectRatio(aspectRatio);
  if (!aspect) return {};

  const size = getImageCardSizeForRatio(String(aspectRatio), aspect);
  return {
    height: size.h,
    contentW: size.w,
    contentH: size.h,
    aspectRatio: String(aspectRatio),
  };
}

function parseTaskMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}

/** 文本任务(如 assistant_chat)的结果在 resultMeta 里而非 resultUrl；按常见键取回复文本 */
function extractTextResult(task: AiTaskVO): string {
  const meta = parseTaskMeta(task.resultMeta);
  for (const key of ["text", "content", "answer", "message", "response", "output"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * 把单张 2×2 四宫格(如 Midjourney 原生输出)切成 4 张独立图并以组图展示：
 * 切块后先用本地 blob 立即升级为组图(秒显)，再后台静默上传，完成后无感替换为远端地址；
 * 上传失败回退为原四宫格单图(本地 blob 不可持久化)。
 */
async function sliceGridAndApply(nodeId: string, gridUrl: string) {
  let blobUrls: string[] = [];
  // 新鲜度校验:切图+4 次上传是后台异步,期间节点已解锁,用户可能重新生成。
  // 写回前确认节点当前展示的仍是本轮结果(gridUrl 或本轮 blob 主图),
  // 否则丢弃——不能用旧一轮的切片覆盖新结果。
  const fresh = () => {
    const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
    return !!n && (n.imageSrc === gridUrl || (blobUrls.length > 0 && n.imageSrc === blobUrls[0]));
  };
  try {
    const slices = await sliceImageGrid(gridUrl, 2, 2);
    if (slices.length !== 4) return;
    blobUrls = slices.map((s) => URL.createObjectURL(s.blob));
    if (!fresh()) {
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    useCanvasStore.getState().updateNode(nodeId, { images: blobUrls, imageSrc: blobUrls[0] });

    const remote: string[] = [];
    let firstFile: { fileSize: number; fileType: string; mimeType: string } | null = null;
    for (const s of slices) {
      const up = await uploadFileSmart(
          new File([s.blob], `grid-${s.cellIndex + 1}.png`, { type: "image/png" }));
      if (!up.success || !up.data?.fileUrl) throw new Error("upload failed");
      remote.push(up.data.fileUrl);
      if (!firstFile) firstFile = { fileSize: up.data.fileSize, fileType: up.data.fileType, mimeType: up.data.mimeType };
    }
    if (!fresh()) {
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    useCanvasStore.getState().updateNode(nodeId, { images: remote, imageSrc: remote[0], ...(firstFile ? { fileSize: firstFile.fileSize, fileType: firstFile.fileType, mimeType: firstFile.mimeType } : {}) });
    const toRevoke = blobUrls;
    blobUrls = [];
    setTimeout(() => toRevoke.forEach((u) => URL.revokeObjectURL(u)), 5000);
  } catch {
    // 取图/切图失败：保持原四宫格单图；上传失败：回退单图(blob 刷新即失效,不可保留)
    if (fresh()) useCanvasStore.getState().updateNode(nodeId, { images: undefined, imageSrc: gridUrl });
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}

function markGenerationFailed(nodeId: string, expectedIdentity?: string) {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (expectedIdentity && !matchesCanvasGeneration(node, expectedIdentity)) return false;
  const nextStatus: CanvasNode["status"] = node?.imageSrc || node?.videoSrc || node?.audioSrc || node?.modelSrc || node?.content ? "success" : "error";
  store.updateNode(nodeId, {
    status: nextStatus,
    taskId: undefined,
    pendingGeneration: undefined,
  });
  return true;
}

/** 轮询任务状态直到完成 */
function pollTask(nodeId: string, taskId: string, startTime: number, input: Record<string, unknown>, maxPollMs: number, gridOutput?: boolean, onSuccess?: (resultUrl: string) => void) {
  let transientFailures = 0;
  let reconnectNoticeShown = false;
  let deadlineNoticeShown = false;
  const poll = async () => {
    // 本轮 timer 已触发,从表中摘除;继续轮询时会重新登记
    pollTimers.delete(nodeId);
    // 登记表比对:本任务已被停止(离开画布)或被同节点的新一轮生成替换 → 静默退出
    if (activeTasks.get(nodeId) !== taskId) return;
    // Node state is the durable compare-and-swap token. A stale provider task
    // must never overwrite a later upload/generation merely because its module
    // level polling entry survived longer.
    if (!matchesCanvasGeneration(
      useCanvasStore.getState().nodes.find((node) => node.id === nodeId),
      taskId,
    )) {
      finish(nodeId, taskId);
      return;
    }
    // 目标节点已被删除:静默停轮,否则会对着空节点持续轮询,
    // 结束时还会给不存在的节点弹「生成成功/失败」
    if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) {
      finish(nodeId, taskId);
      return;
    }
    // maxPollMs is a UI polling budget, not a backend terminal state. A long
    // provider queue may legitimately outlive it, so keep the taskId and switch
    // to a slower reconciliation cadence instead of making the task orphaned.
    const beyondPollingBudget = Date.now() - startTime > maxPollMs;
    if (beyondPollingBudget && !deadlineNoticeShown) {
      deadlineNoticeShown = true;
      toast.info("生成时间较长，仍在后台继续确认结果");
    }

    try {
      const res = await aiApi.getTask(taskId);
      if (activeTasks.get(nodeId) !== taskId) return; // await 期间被停止/替换
      if (!matchesCanvasGeneration(
        useCanvasStore.getState().nodes.find((node) => node.id === nodeId),
        taskId,
      )) {
        finish(nodeId, taskId);
        return;
      }
      const updateNode = useCanvasStore.getState().updateNode;
      if (!res.success || !res.data) {
        // 查询失败 ≠ 任务失败:http 层把断网/网关 5xx 都归一为 success:false。
        // 长任务(视频可达 40 分钟)期间一次 Wi-Fi 抖动/瞬时 502 不能把仍在
        // 执行且已扣积分的任务判死。401 可能只是 refresh 服务暂时失败；
        // 408/429 也不能证明任务不存在。明确业务拒绝或其它 4xx 则终止；
        // 尤其 400 表示持久化 taskId 已损坏，继续轮询只会永久转圈。
        const unrecoverableLookup = !isAmbiguousAiCreateCode(res.code);
        if (unrecoverableLookup) {
          markGenerationFailed(nodeId, taskId);
          finish(nodeId, taskId);
          toast.error(res.message || "生成失败");
          return;
        }
        transientFailures += 1;
        if (!reconnectNoticeShown) {
          reconnectNoticeShown = true;
          toast.info("连接暂时中断，正在自动恢复生成状态");
        }
        const retryDelay = Math.min(15_000, POLL_INTERVAL * (2 ** Math.min(3, transientFailures - 1)));
        pollTimers.set(nodeId, setTimeout(poll, beyondPollingBudget ? Math.max(10_000, retryDelay) : retryDelay));
        return;
      }
      transientFailures = 0;
      const task: AiTaskVO = res.data;
      if (task.status === AiTaskStatus.SUCCESS) {
        const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        // 文本节点：结果在 resultMeta 而非 resultUrl，直接写回 content
        if (node?.type === "text") {
          const text = extractTextResult(task);
          if (!text) {
            markGenerationFailed(nodeId, taskId);
            toast.error("生成结果为空，请重试");
          } else {
            updateNode(nodeId, { status: "success", content: text, taskId: undefined });
            toast.success("生成成功");
            onSuccess?.(text);
          }
          finish(nodeId, taskId);
          return;
        }
        // 校验 URL：只接受 http(s):// 或 data: 开头的合法地址
        const isValid = (u?: string): u is string =>
          !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));
        const taskMeta = parseTaskMeta(task.resultMeta);
        const isThreeD = node?.type === "3d";
        const modelAssets = isThreeD ? canvasThreeDAssetsFromMeta(taskMeta) : [];
        const primary = isThreeD
          ? (isValid(task.resultUrl) ? task.resultUrl : modelAssets[0]?.url)
          : task.resultUrl;
        if (!isValid(primary)) {
          markGenerationFailed(nodeId, taskId);
          toast.error("生成结果无效，可能未配置 AI 供应商");
        } else {
          const isVideo = node?.type === "video";
          const isAudio = node?.type === "audio";
          const requestedAspect = input.aspectRatio ?? input.aspect_ratio ?? input.ratio;
          const imageSize = node ? imageSizeForAspect(node, requestedAspect) : {};
          // 批量多图(如 Midjourney 一组 4 张)：全部存入本节点 images，节点内组图交互展示
          const rawUrls = taskMeta.urls;
          const urls = Array.isArray(rawUrls) ? rawUrls.filter((u): u is string => isValid(u as string)) : [];
          const isBatch = !isVideo && !isAudio && !isThreeD && urls.length > 1;
          // 音乐分轨（Suno 一次两首）：url 与 resultMeta.tracks 同序，写入节点内切换
          const audioTracks = isAudio && urls.length > 1
            ? urls.map((u, i) => {
                const tr = Array.isArray(taskMeta.tracks) ? taskMeta.tracks[i] as Record<string, unknown> | undefined : undefined;
                const s = (v: unknown) => (typeof v === "string" ? v : undefined);
                return { url: u, title: s(tr?.title), clipId: s(tr?.clipId) };
              })
            : undefined;
          const previewImage = modelAssets.find((asset) => asset.previewImageUrl)?.previewImageUrl;
          // 视频写 videoSrc、音频写 audioSrc、3D 写 modelSrc/modelAssets，其余写 imageSrc。
          updateNode(
            nodeId,
            isVideo ? { status: "success", videoSrc: primary, taskId: undefined }
              : isAudio ? { status: "success", audioSrc: primary, audioTracks, taskId: undefined }
              : isThreeD ? {
                  status: "success",
                  modelSrc: primary,
                  modelAssets: modelAssets.length ? modelAssets : [{ type: "model", url: primary }],
                  modelPreviewSrc: previewImage,
                  taskId: undefined,
                }
              : { status: "success", imageSrc: primary, images: isBatch ? urls : undefined, taskId: undefined, ...imageSize },
          );
          // 四宫格模型(如 Midjourney)返回单张合图：异步切成 4 张独立图后升级为组图
          if (!isVideo && !isAudio && !isThreeD && gridOutput && urls.length <= 1) {
            void sliceGridAndApply(nodeId, primary);
          }
          toast.success("生成成功");
          onSuccess?.(primary);
        }
        finish(nodeId, taskId);
      } else if (task.status === AiTaskStatus.FAILED) {
        markGenerationFailed(nodeId, taskId);
        toast.error(task.errorMsg || "生成失败");
        finish(nodeId, taskId);
      } else if (task.status === AiTaskStatus.CANCELLED) {
        updateNode(nodeId, { status: "idle", taskId: undefined });
        finish(nodeId, taskId);
      } else {
        // 仍在处理中，继续轮询
        pollTimers.set(nodeId, setTimeout(poll, beyondPollingBudget ? 10_000 : POLL_INTERVAL));
      }
    } catch {
      // fetch/http normally returns code:0 instead of throwing, but keep the
      // exceptional path equally recoverable. Never clear a durable taskId on
      // a transport exception: refresh/reopen can still reconcile this task.
      if (activeTasks.get(nodeId) !== taskId) return;
      transientFailures += 1;
      if (!reconnectNoticeShown) {
        reconnectNoticeShown = true;
        toast.info("连接暂时中断，正在自动恢复生成状态");
      }
      const retryDelay = Math.min(15_000, POLL_INTERVAL * (2 ** Math.min(3, transientFailures - 1)));
      pollTimers.set(nodeId, setTimeout(poll, retryDelay));
    }
  };
  poll();
}

function saveGenerationState(projectId?: string) {
  if (projectId) void requestCanvasSave(projectId);
}

/**
 * Replays a frozen create request with the same clientRequestId until the
 * backend returns its task id. The first POST may already have charged the
 * user, so an ambiguous response is a recoverable state, never an idle/error
 * state that invites a second generation.
 */
async function reconcilePendingGeneration(
  nodeId: string,
  pending: CanvasPendingGeneration,
  onSuccess?: (resultUrl: string) => void,
): Promise<GenerationStartResult> {
  const marker = pendingMarker(pending.clientRequestId);
  if (activeTasks.get(nodeId) !== marker) return { status: "ambiguous" };
  const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === nodeId);
  if (!pendingMatches(currentNode, pending)) {
    finish(nodeId, marker);
    return { status: "rejected" };
  }

  const dto: AiGenerateInput = {
    handler: pending.handler,
    modelId: pending.modelId,
    input: pending.input,
    clientRequestId: pending.clientRequestId,
    ...(pending.projectId ? { projectId: pending.projectId } : {}),
    ...(pending.entryPoint ? { entryPoint: pending.entryPoint } : {}),
    ...(pending.targetType ? { targetType: pending.targetType } : {}),
  };

  try {
    const res = await aiApi.generateIdempotent(
      dto,
      `canvas:${pending.projectId || "unsaved"}:${nodeId}`,
    );
    if (activeTasks.get(nodeId) !== marker) return { status: "ambiguous" };
    if (!matchesCanvasGeneration(
      useCanvasStore.getState().nodes.find((node) => node.id === nodeId),
      marker,
    )) {
      finish(nodeId, marker);
      return { status: "rejected" };
    }
    if (res.success && res.data?.id) {
      const taskId = String(res.data.id);
      if (!validTaskId(taskId)) {
        markGenerationFailed(nodeId, marker);
        saveGenerationState(pending.projectId);
        finish(nodeId, marker);
        toast.error("生成任务标识无效，请稍后重试");
        return { status: "rejected" };
      }
      pendingCreateAttempts.delete(nodeId);
      pendingCreateNotified.delete(nodeId);
      track(nodeId, taskId);
      useCanvasStore.getState().updateNode(nodeId, {
        status: "generating",
        taskId,
        pendingGeneration: undefined,
      }, false);
      saveGenerationState(pending.projectId);
      const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      const maxPollMs = node?.type === "video"
        ? MAX_POLL_TIME_VIDEO
        : node?.type === "audio"
          ? MAX_POLL_TIME_AUDIO
          : node?.type === "3d"
            ? MAX_POLL_TIME_3D
            : MAX_POLL_TIME;
      pollTask(nodeId, taskId, Date.now(), pending.input, maxPollMs, pending.gridOutput, onSuccess);
      return { status: "started", taskId };
    }

    if (!isAmbiguousAiCreateCode(res.code)) {
      markGenerationFailed(nodeId, marker);
      saveGenerationState(pending.projectId);
      finish(nodeId, marker);
      toast.error(res.message || "生成请求失败");
      return { status: "rejected" };
    }
  } catch {
    // Transport exceptions are indistinguishable from a response lost after
    // commit. Keep the durable snapshot and retry below.
  }

  const attempts = (pendingCreateAttempts.get(nodeId) ?? 0) + 1;
  pendingCreateAttempts.set(nodeId, attempts);
  if (!pendingCreateNotified.has(nodeId)) {
    pendingCreateNotified.add(nodeId);
    toast.info("生成请求已提交，正在确认任务状态");
  }
  const age = Date.now() - pending.createdAt;
  const retryDelay = age > 30 * 60 * 1000
    ? 30_000
    : Math.min(15_000, 1500 * (2 ** Math.min(3, attempts - 1)));
  pollTimers.set(nodeId, setTimeout(() => {
    pollTimers.delete(nodeId);
    void reconcilePendingGeneration(nodeId, pending, onSuccess);
  }, retryDelay));
  return { status: "ambiguous" };
}

/** 开始生成（批量多图的多余图片以组图存入本节点，首张为主图） */
async function startGeneration({ nodeId, handler, modelId, input, clientRequestId, gridOutput, onSuccess }: GenerateParams): Promise<GenerationStartResult> {
  // 防止重复触发（登记表是画布级的,跨组件对同一节点的并发生成同样被拦）
  if (activeTasks.has(nodeId)) {
    toast.info("生成中，请稍候");
    return { status: "rejected" };
  }
  // 音乐的自定义歌词/延长/翻唱模式不发描述（歌词/原曲 clip 才是主输入），
  // 带 lyrics 或 extras 的音频请求豁免空提示词校验。
  const audioAltInput = handler === "text_to_audio" && (!!input.lyrics || !!input.extras);
  const threeDReferenceInput = handler === "generate_3d" && (
    (typeof input.imageUrl === "string" && input.imageUrl.trim().length > 0)
    || (Array.isArray(input.multiViewImages) && input.multiViewImages.length > 0)
  );
  if ((!input.prompt || String(input.prompt).trim().length === 0) && !audioAltInput && !threeDReferenceInput) {
    toast.error("请先输入提示词");
    return { status: "rejected" };
  }
  // 按 handler 的必填参数统一兜底:各节点正常都做了前置校验,这里防的是
  // 新增调用方漏写校验后裸发到后端(上游报错既贵又晚)。键名与服务端
  // provider_relay 的取参口径一致(inputImageURLs / startEndFrames)。
  const missingRequired = (): string | null => {
    const has = (v: unknown) =>
      Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";
    const anyImage =
      has(input.imageList) || has(input.image_urls) || has(input.imageUrls) ||
      has(input.sourceImage) || has(input.imageUrl) || has(input.image_url) ||
      has(input.references);
    switch (handler) {
      case "image_to_image":
        return anyImage ? null : "图片编辑需要至少一张参考图";
      case "image_to_video":
        return anyImage || has(input.firstFrame) ? null : "图生视频需要一张源图片";
      case "start_end_to_video":
        // 尾帧服务端会回退首帧,首帧是硬必填
        return has(input.firstFrame) || has(input.startImageUrl) || anyImage
          ? null
          : "首尾帧模式需要上传首帧";
      case "reference_to_video": {
        const anyRef =
          anyImage ||
          has(input.videoReferences) || has(input.video_urls) ||
          has(input.audioReferences) || has(input.audio_urls);
        return anyRef ? null : "参考生视频需要至少一个参考素材";
      }
      case "text_to_audio": {
        const ex = (input.extras ?? {}) as Record<string, unknown>;
        const t = typeof ex.task === "string" ? ex.task : "";
        if (t === "extend" || t === "upload_extend")
          return has(ex.continue_clip_id) ? null : "延长模式需先选择原曲";
        if (t === "cover") return has(ex.cover_clip_id) ? null : "翻唱模式需先选择原曲";
        return null;
      }
      case "generate_3d":
        return has(input.prompt) || has(input.imageUrl) || has(input.multiViewImages)
          ? null
          : "3D 生成需要提示词或参考图片";
      default:
        return null;
    }
  };
  const missMsg = missingRequired();
  if (missMsg) {
    toast.error(missMsg);
    return { status: "rejected" };
  }

  const store = useCanvasStore.getState();
  const targetNode = store.nodes.find((item) => item.id === nodeId);
  if (!targetNode) {
    toast.error("生成节点不存在，请重新选择节点");
    return { status: "rejected" };
  }
  if (targetNode.uploading) {
    toast.info("素材上传完成后再开始生成");
    return { status: "rejected" };
  }
  if (targetNode.status === "generating" || targetNode.taskId || targetNode.pendingGeneration) {
    toast.info("生成中，请稍候");
    return { status: "rejected" };
  }
  const projectId = store.currentProjectId || undefined;
  if (!projectId) {
    toast.error("画布尚未保存，请稍后再试");
    return { status: "rejected" };
  }
  const explicitRequestId = clientRequestId;
  if (
    explicitRequestId !== undefined
    && (
      explicitRequestId.trim() !== explicitRequestId
      || explicitRequestId.length === 0
      || explicitRequestId.length > 96
    )
  ) {
    toast.error("生成请求标识无效，请刷新后重试");
    return { status: "rejected" };
  }
  const stableClientRequestId = explicitRequestId || createGenerationRequestId();
  let frozenInput: Record<string, unknown>;
  try {
    // The recovery snapshot is written into canvasData as JSON. Freeze the
    // exact JSON payload that fetch will send, rather than accepting cloneable
    // values (File/Blob/Map) that JSON.stringify would later collapse and make
    // a refresh replay a different request.
    frozenInput = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    if (!frozenInput || typeof frozenInput !== "object" || Array.isArray(frozenInput)) {
      throw new Error("generation input is not a JSON object");
    }
  } catch {
    toast.error("生成参数无法保存，请重新选择素材后再试");
    return { status: "rejected" };
  }
  const pending: CanvasPendingGeneration = {
    version: 1,
    handler,
    modelId,
    input: frozenInput,
    clientRequestId: stableClientRequestId,
    projectId,
    // Preserve the canvas node semantic so generation history can distinguish
    // ordinary images from generated character/scene assets.
    entryPoint: "canvas",
    ...(targetNode?.type ? { targetType: targetNode.type } : {}),
    ...(gridOutput ? { gridOutput: true } : {}),
    createdAt: Date.now(),
  };
  const marker = pendingMarker(stableClientRequestId);
  track(nodeId, marker);
  store.updateNode(nodeId, {
    status: "generating",
    taskId: undefined,
    pendingGeneration: pending,
  }, false);

  // Persist the frozen recovery request before the paid create call. If the
  // canvas itself cannot be saved, do not start a task that a refresh could
  // orphan; the user can retry after persistence recovers without any charge.
  const recoverySaved = await requestCanvasSave(projectId);
  if (activeTasks.get(nodeId) !== marker) return { status: "ambiguous" };
  if (!recoverySaved) {
    const current = useCanvasStore.getState().nodes.find((node) => node.id === nodeId);
    const hasResult = !!(current?.imageSrc || current?.videoSrc || current?.audioSrc || current?.modelSrc || current?.content);
    useCanvasStore.getState().updateNode(nodeId, {
      status: hasResult ? "success" : "idle",
      pendingGeneration: undefined,
      taskId: undefined,
    }, false);
    finish(nodeId, marker);
    toast.error("画布暂时无法保存，未开始生成，请重试");
    return { status: "rejected" };
  }
  return reconcilePendingGeneration(nodeId, pending, onSuccess);
}

/** 画布加载后调用：已有 taskId 的按任务号续轮；创建响应尚未确认的节点用
 *  持久化 frozen request + clientRequestId 重新取回同一 taskId。 */
export function resumeGeneration() {
  const { nodes, currentProjectId } = useCanvasStore.getState();
  for (const node of nodes) {
    if (node.status !== "generating" || activeTasks.has(node.id)) continue;
    if (validTaskId(node.taskId)) {
      const maxPollMs = node.type === "video"
        ? MAX_POLL_TIME_VIDEO
        : node.type === "audio"
          ? MAX_POLL_TIME_AUDIO
          : node.type === "3d"
            ? MAX_POLL_TIME_3D
            : MAX_POLL_TIME;
      track(node.id, node.taskId);
      // 画幅从节点已持久化的 aspectRatio 恢复;超时预算从当前时刻重新起算(有整体上限兜底)
      pollTask(node.id, node.taskId, Date.now(), node.aspectRatio ? { aspectRatio: node.aspectRatio } : {}, maxPollMs);
      continue;
    }
    const pending = node.pendingGeneration;
    if (
      validPendingGeneration(pending)
      && (!pending.projectId || pending.projectId === currentProjectId)
    ) {
      track(node.id, pendingMarker(pending.clientRequestId));
      void reconcilePendingGeneration(node.id, pending);
      continue;
    }
    // Invalid legacy/transient state cannot safely create a task. Clear it
    // instead of leaving a permanent spinner or inventing a new request id.
    markGenerationFailed(node.id);
    saveGenerationState(currentProjectId || undefined);
  }
}

/** 组件侧薄封装:generate 是模块级函数(引用恒定),isGenerating 订阅画布级登记表 */
export function useAiGeneration() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isGenerating = useCallback((nodeId: string) => active.has(nodeId), [active]);
  return { generate: startGeneration, isGenerating };
}
