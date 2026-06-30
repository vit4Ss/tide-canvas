"use client";

import { useCallback, useRef, useState } from "react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { sliceImageGrid } from "@/lib/image-slice";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiTaskVO, AiGenerateDTO } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";
import { toast } from "@/components/shared/toast";

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
const IMAGE_CARD_BASE_WIDTH = 608;

function parseAspectRatio(value: unknown): number | null {
  if (typeof value !== "string" || value === "auto") return null;
  const [w, h] = value.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

function imageSizeForAspect(node: CanvasNode, aspectRatio: unknown) {
  const aspect = parseAspectRatio(aspectRatio);
  if (!aspect) return {};
  const width = IMAGE_CARD_BASE_WIDTH;
  const height = Math.round(width / aspect);
  return {
    height,
    contentW: width,
    contentH: height,
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

/**
 * 把单张 2×2 四宫格(如 Midjourney 原生输出)切成 4 张独立图并以组图展示：
 * 切块后先用本地 blob 立即升级为组图(秒显)，再后台静默上传，完成后无感替换为远端地址；
 * 上传失败回退为原四宫格单图(本地 blob 不可持久化)。
 */
async function sliceGridAndApply(nodeId: string, gridUrl: string) {
  let blobUrls: string[] = [];
  try {
    const slices = await sliceImageGrid(gridUrl, 2, 2);
    if (slices.length !== 4) return;
    blobUrls = slices.map((s) => URL.createObjectURL(s.blob));
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
    useCanvasStore.getState().updateNode(nodeId, { images: remote, imageSrc: remote[0], ...(firstFile ? { fileSize: firstFile.fileSize, fileType: firstFile.fileType, mimeType: firstFile.mimeType } : {}) });
    const toRevoke = blobUrls;
    blobUrls = [];
    setTimeout(() => toRevoke.forEach((u) => URL.revokeObjectURL(u)), 5000);
  } catch {
    // 取图/切图失败：保持原四宫格单图；上传失败：回退单图(blob 刷新即失效,不可保留)
    useCanvasStore.getState().updateNode(nodeId, { images: undefined, imageSrc: gridUrl });
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}

/** 把批量生成的多余图片（首张已写回原节点）铺成新图片节点，排在原节点右侧，整批一次撤销 */
export function useAiGeneration() {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const [activeTaskIds, setActiveTaskIds] = useState<Set<string>>(new Set());
  const pollTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const markGenerationFailed = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    const nextStatus: CanvasNode["status"] = node?.imageSrc || node?.videoSrc || node?.audioSrc ? "success" : "error";
    updateNode(nodeId, { status: nextStatus });
  }, [updateNode]);

  /** 轮询任务状态直到完成 */
  const pollTask = useCallback((nodeId: string, taskId: string | number, startTime: number, input: Record<string, unknown>, maxPollMs: number, gridOutput?: boolean, onSuccess?: (resultUrl: string) => void) => {
    const poll = async () => {
      // 超时检查
      if (Date.now() - startTime > maxPollMs) {
        markGenerationFailed(nodeId);
        toast.error("生成超时，请重试");
        setActiveTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        return;
      }

      try {
        const res = await aiApi.getTask(taskId as number);
        if (!res.success) {
          markGenerationFailed(nodeId);
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
          toast.error(res.message || "生成失败");
          return;
        }
        const task: AiTaskVO = res.data;
        if (task.status === AiTaskStatus.SUCCESS) {
          // 校验 URL：只接受 http(s):// 或 data: 开头的合法地址
          const isValid = (u?: string): u is string =>
            !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));
          const primary = task.resultUrl;
          if (!isValid(primary)) {
            markGenerationFailed(nodeId);
            toast.error("生成结果无效，可能未配置 AI 供应商");
          } else {
            const store = useCanvasStore.getState();
            const node = store.nodes.find((n) => n.id === nodeId);
            const isVideo = node?.type === "video";
            const isAudio = node?.type === "audio";
            const requestedAspect = input.aspectRatio ?? input.aspect_ratio ?? input.ratio;
            const imageSize = node ? imageSizeForAspect(node, requestedAspect) : {};
            // 批量多图(如 Midjourney 一组 4 张)：全部存入本节点 images，节点内组图交互展示
            const taskMeta = parseTaskMeta(task.resultMeta);
            const rawUrls = taskMeta.urls;
            const urls = Array.isArray(rawUrls) ? rawUrls.filter((u): u is string => isValid(u as string)) : [];
            const isBatch = !isVideo && !isAudio && urls.length > 1;
            // 视频写 videoSrc、音频写 audioSrc、图片写 imageSrc(+组图 images)
            updateNode(
              nodeId,
              isVideo ? { status: "success", videoSrc: primary }
                : isAudio ? { status: "success", audioSrc: primary }
                : { status: "success", imageSrc: primary, images: isBatch ? urls : undefined, ...imageSize },
            );
            // 四宫格模型(如 Midjourney)返回单张合图：异步切成 4 张独立图后升级为组图
            if (!isVideo && !isAudio && gridOutput && urls.length <= 1) {
              void sliceGridAndApply(nodeId, primary);
            }
            toast.success("生成成功");
            onSuccess?.(primary);
          }
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        } else if (task.status === AiTaskStatus.FAILED) {
          markGenerationFailed(nodeId);
          toast.error(task.errorMsg || "生成失败");
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        } else if (task.status === AiTaskStatus.CANCELLED) {
          updateNode(nodeId, { status: "idle" });
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        } else {
          // 仍在处理中，继续轮询
          const timer = setTimeout(poll, POLL_INTERVAL);
          pollTimersRef.current.set(nodeId, timer);
        }
      } catch {
        markGenerationFailed(nodeId);
        toast.error("网络错误");
        setActiveTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    };
    poll();
  }, [markGenerationFailed, updateNode]);

  /** 开始生成 */
  const generate = useCallback(async ({ nodeId, handler, modelId, input, gridOutput, onSuccess }: GenerateParams) => {
    // 防止重复触发
    if (activeTaskIds.has(nodeId)) {
      toast.info("生成中，请稍候");
      return;
    }
    if (!input.prompt || String(input.prompt).trim().length === 0) {
      toast.error("请先输入提示词");
      return;
    }

    setActiveTaskIds((prev) => new Set(prev).add(nodeId));
    updateNode(nodeId, { status: "generating" });

    const dto: AiGenerateDTO = { handler, modelId, input, ...(currentProjectId ? { projectId: currentProjectId } : {}) };
    try {
      const res = await aiApi.generate(dto);
      if (!res.success) {
        markGenerationFailed(nodeId);
        toast.error(res.message || "生成请求失败");
        setActiveTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        return;
      }
      // 启动轮询：视频任务后端可能需 10min+，前端上限按节点类型放宽，避免早于后端放弃而误判失败
      const startedNode = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const maxPollMs = startedNode?.type === "video" ? MAX_POLL_TIME_VIDEO : MAX_POLL_TIME;
      pollTask(nodeId, res.data.id, Date.now(), input, maxPollMs, gridOutput, onSuccess);
    } catch {
      markGenerationFailed(nodeId);
      toast.error("网络错误");
      setActiveTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [activeTaskIds, updateNode, markGenerationFailed, pollTask, currentProjectId]);

  const isGenerating = useCallback((nodeId: string) => activeTaskIds.has(nodeId), [activeTaskIds]);

  return { generate, isGenerating };
}
