"use client";

import { useCallback, useSyncExternalStore } from "react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { sliceImageGrid } from "@/lib/image-slice";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiTaskVO, AiGenerateDTO } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import { getImageCardSizeForRatio } from "@/lib/image-card-size";

interface GenerateParams {
  nodeId: string;
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
  /** 上游返回单张 2×2 四宫格(如 Midjourney)：成功后前端切成 4 张独立图并以组图展示 */
  gridOutput?: boolean;
  /** 生成成功回调，参数为结果地址（如全景生成后用于打开 360 查看器） */
  onSuccess?: (resultUrl: string) => void;
}

const POLL_INTERVAL = 2000; // 2 秒轮询
const MAX_POLL_TIME = 5 * 60 * 1000; // 图片等快任务：最多 5 分钟
// 视频较慢（后端轮询可达 10min+），前端上限须 ≥ 后端，否则前端会先放弃、把已成功的任务误标失败、且不回填结果
const MAX_POLL_TIME_VIDEO = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// 画布级轮询单例
//
// 轮询状态是模块级的,不属于任何组件实例:任务的目标节点(nodeId)与发起生成的
// 组件可以不是同一个(全景/多角度/视频重新生成都从 A 节点写入 B 节点),若轮询
// 器活在发起组件里,删掉 A 会连带停掉 B 的轮询。这里按 nodeId→taskId 登记,
// 生命周期只跟画布页面(stopAllGeneration)和节点存活挂钩。
// ---------------------------------------------------------------------------

/** nodeId → taskId；空串表示生成请求在途、任务号未返回（用于防双击） */
const activeTasks = new Map<string, string>();
const pollTimers = new Map<string, NodeJS.Timeout>();
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
function finish(nodeId: string) {
  const timer = pollTimers.get(nodeId);
  if (timer) {
    clearTimeout(timer);
    pollTimers.delete(nodeId);
  }
  if (activeTasks.delete(nodeId)) emit();
}

/** 离开画布页面时调用：停止全部轮询链。在途的 await 返回后会因登记表比对失败而自行退出。 */
export function stopAllGeneration() {
  pollTimers.forEach((t) => clearTimeout(t));
  pollTimers.clear();
  if (activeTasks.size > 0) {
    activeTasks.clear();
    emit();
  }
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

function markGenerationFailed(nodeId: string) {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const nextStatus: CanvasNode["status"] = node?.imageSrc || node?.videoSrc || node?.audioSrc || node?.content ? "success" : "error";
  store.updateNode(nodeId, { status: nextStatus, taskId: undefined });
}

/** 轮询任务状态直到完成 */
function pollTask(nodeId: string, taskId: string, startTime: number, input: Record<string, unknown>, maxPollMs: number, gridOutput?: boolean, onSuccess?: (resultUrl: string) => void) {
  const poll = async () => {
    // 本轮 timer 已触发,从表中摘除;继续轮询时会重新登记
    pollTimers.delete(nodeId);
    // 登记表比对:本任务已被停止(离开画布)或被同节点的新一轮生成替换 → 静默退出
    if (activeTasks.get(nodeId) !== taskId) return;
    // 目标节点已被删除:静默停轮,否则会对着空节点空转最长 30 分钟,
    // 结束时还会给不存在的节点弹「生成成功/失败」
    if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) {
      finish(nodeId);
      return;
    }
    // 超时检查
    if (Date.now() - startTime > maxPollMs) {
      markGenerationFailed(nodeId);
      toast.error("生成超时，请重试");
      finish(nodeId);
      return;
    }

    try {
      const res = await aiApi.getTask(taskId);
      if (activeTasks.get(nodeId) !== taskId) return; // await 期间被停止/替换
      const updateNode = useCanvasStore.getState().updateNode;
      if (!res.success || !res.data) {
        // 查询失败 ≠ 任务失败:http 层把断网/网关 5xx 都归一为 success:false。
        // 长任务(视频可达 30 分钟)期间一次 Wi-Fi 抖动/瞬时 502 不能把仍在
        // 执行且已扣积分的任务判死。仅明确 4xx(任务不存在/无权)终止,
        // 其余视为瞬时故障继续轮询,由整体超时兜底。
        if (res.code >= 400 && res.code < 500) {
          markGenerationFailed(nodeId);
          finish(nodeId);
          toast.error(res.message || "生成失败");
          return;
        }
        pollTimers.set(nodeId, setTimeout(poll, POLL_INTERVAL));
        return;
      }
      const task: AiTaskVO = res.data;
      if (task.status === AiTaskStatus.SUCCESS) {
        const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        // 文本节点：结果在 resultMeta 而非 resultUrl，直接写回 content
        if (node?.type === "text") {
          const text = extractTextResult(task);
          if (!text) {
            markGenerationFailed(nodeId);
            toast.error("生成结果为空，请重试");
          } else {
            updateNode(nodeId, { status: "success", content: text, taskId: undefined });
            toast.success("生成成功");
            onSuccess?.(text);
          }
          finish(nodeId);
          return;
        }
        // 校验 URL：只接受 http(s):// 或 data: 开头的合法地址
        const isValid = (u?: string): u is string =>
          !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));
        const primary = task.resultUrl;
        if (!isValid(primary)) {
          markGenerationFailed(nodeId);
          toast.error("生成结果无效，可能未配置 AI 供应商");
        } else {
          const isVideo = node?.type === "video";
          const isAudio = node?.type === "audio";
          const requestedAspect = input.aspectRatio ?? input.aspect_ratio ?? input.ratio;
          const imageSize = node ? imageSizeForAspect(node, requestedAspect) : {};
          // 批量多图(如 Midjourney 一组 4 张)：全部存入本节点 images，节点内组图交互展示
          const taskMeta = parseTaskMeta(task.resultMeta);
          const rawUrls = taskMeta.urls;
          const urls = Array.isArray(rawUrls) ? rawUrls.filter((u): u is string => isValid(u as string)) : [];
          const isBatch = !isVideo && !isAudio && urls.length > 1;
          // 音乐分轨（Suno 一次两首）：url 与 resultMeta.tracks 同序，写入节点内切换
          const audioTracks = isAudio && urls.length > 1
            ? urls.map((u, i) => {
                const tr = Array.isArray(taskMeta.tracks) ? taskMeta.tracks[i] as Record<string, unknown> | undefined : undefined;
                const s = (v: unknown) => (typeof v === "string" ? v : undefined);
                return { url: u, title: s(tr?.title), clipId: s(tr?.clipId) };
              })
            : undefined;
          // 视频写 videoSrc、音频写 audioSrc(+分轨 audioTracks)、图片写 imageSrc(+组图 images)
          updateNode(
            nodeId,
            isVideo ? { status: "success", videoSrc: primary, taskId: undefined }
              : isAudio ? { status: "success", audioSrc: primary, audioTracks, taskId: undefined }
              : { status: "success", imageSrc: primary, images: isBatch ? urls : undefined, taskId: undefined, ...imageSize },
          );
          // 四宫格模型(如 Midjourney)返回单张合图：异步切成 4 张独立图后升级为组图
          if (!isVideo && !isAudio && gridOutput && urls.length <= 1) {
            void sliceGridAndApply(nodeId, primary);
          }
          toast.success("生成成功");
          onSuccess?.(primary);
        }
        finish(nodeId);
      } else if (task.status === AiTaskStatus.FAILED) {
        markGenerationFailed(nodeId);
        toast.error(task.errorMsg || "生成失败");
        finish(nodeId);
      } else if (task.status === AiTaskStatus.CANCELLED) {
        updateNode(nodeId, { status: "idle", taskId: undefined });
        finish(nodeId);
      } else {
        // 仍在处理中，继续轮询
        pollTimers.set(nodeId, setTimeout(poll, POLL_INTERVAL));
      }
    } catch {
      markGenerationFailed(nodeId);
      toast.error("网络错误");
      finish(nodeId);
    }
  };
  poll();
}

/** 开始生成（批量多图的多余图片以组图存入本节点，首张为主图） */
async function startGeneration({ nodeId, handler, modelId, input, gridOutput, onSuccess }: GenerateParams) {
  // 防止重复触发（登记表是画布级的,跨组件对同一节点的并发生成同样被拦）
  if (activeTasks.has(nodeId)) {
    toast.info("生成中，请稍候");
    return;
  }
  // 音乐的自定义歌词/延长/翻唱模式不发描述（歌词/原曲 clip 才是主输入），
  // 带 lyrics 或 extras 的音频请求豁免空提示词校验。
  const audioAltInput = handler === "text_to_audio" && (!!input.lyrics || !!input.extras);
  if ((!input.prompt || String(input.prompt).trim().length === 0) && !audioAltInput) {
    toast.error("请先输入提示词");
    return;
  }

  track(nodeId, ""); // 占位登记:任务号未返回,先挡住双击
  const store = useCanvasStore.getState();
  store.updateNode(nodeId, { status: "generating" });

  const dto: AiGenerateDTO = { handler, modelId, input, ...(store.currentProjectId ? { projectId: store.currentProjectId } : {}) };
  try {
    const res = await aiApi.generate(dto);
    // await 期间离开画布(stopAllGeneration)：不再起轮询,也不能往可能已切换项目的 store 写
    if (activeTasks.get(nodeId) !== "") return;
    if (!res.success || !res.data?.id) {
      markGenerationFailed(nodeId);
      toast.error(res.message || "生成请求失败");
      finish(nodeId);
      return;
    }
    const taskId = String(res.data.id);
    track(nodeId, taskId);
    // 任务号写上节点并随画布持久化:刷新/重开项目后据此对账续轮(resumeGeneration)
    useCanvasStore.getState().updateNode(nodeId, { taskId });
    // 启动轮询：视频任务后端可能需 10min+，前端上限按节点类型放宽，避免早于后端放弃而误判失败
    const startedNode = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    // 音乐(Suno 双曲)排队+生成同样常超 5 分钟,与视频一致走长上限,
    // 否则前端先于后端放弃,把已成功的任务误标失败且不回填结果
    const maxPollMs = startedNode?.type === "video" || startedNode?.type === "audio"
      ? MAX_POLL_TIME_VIDEO
      : MAX_POLL_TIME;
    pollTask(nodeId, taskId, Date.now(), input, maxPollMs, gridOutput, onSuccess);
  } catch {
    markGenerationFailed(nodeId);
    toast.error("网络错误");
    finish(nodeId);
  }
}

/** 画布加载后调用：对仍在 generating 且带 taskId 的节点按任务号续轮。
 *  刷新/重开项目时轮询器已死,任务却仍在后端执行(且已扣积分)——不续轮的话
 *  结果永远不回填。gridOutput/onSuccess 等仅存在于发起会话的信息不可恢复,
 *  四宫格切图在续轮场景下降级为单图展示。 */
export function resumeGeneration() {
  const { nodes } = useCanvasStore.getState();
  for (const node of nodes) {
    if (node.status !== "generating" || !node.taskId || activeTasks.has(node.id)) continue;
    const maxPollMs = node.type === "video" || node.type === "audio" ? MAX_POLL_TIME_VIDEO : MAX_POLL_TIME;
    track(node.id, node.taskId);
    // 画幅从节点已持久化的 aspectRatio 恢复;超时预算从当前时刻重新起算(有整体上限兜底)
    pollTask(node.id, node.taskId, Date.now(), node.aspectRatio ? { aspectRatio: node.aspectRatio } : {}, maxPollMs);
  }
}

/** 组件侧薄封装:generate 是模块级函数(引用恒定),isGenerating 订阅画布级登记表 */
export function useAiGeneration() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isGenerating = useCallback((nodeId: string) => active.has(nodeId), [active]);
  return { generate: startGeneration, isGenerating };
}
