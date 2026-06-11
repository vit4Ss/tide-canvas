"use client";

import { useCallback, useRef, useState } from "react";
import { aiApi } from "@/lib/api";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiTaskVO, AiGenerateDTO } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";
import { toast } from "@/components/shared/toast";

interface GenerateParams {
  nodeId: string;
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
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

/** 把批量生成的多余图片（首张已写回原节点）铺成新图片节点，排在原节点右侧，整批一次撤销 */
function spreadBatchNodes(store: ReturnType<typeof useCanvasStore.getState>, node: CanvasNode, extraUrls: string[], aspectRatio: unknown) {
  const imageSize = imageSizeForAspect(node, aspectRatio);
  const baseW = imageSize.contentW ?? node.contentW ?? node.width;
  const baseH = imageSize.contentH ?? node.contentH ?? node.height ?? baseW;
  const gap = 24;
  const startX = node.x + baseW + gap;
  extraUrls.forEach((url, i) => {
    store.addNode(
      {
        id: generateNodeId(),
        type: "image",
        x: startX + i * (baseW + gap),
        y: node.y,
        width: node.width,
        height: baseH,
        title: `${node.title || "图片"} ${i + 2}`,
        imageSrc: url,
        status: "success",
        ...imageSize,
      },
      i === 0,
    );
  });
}

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
  const pollTask = useCallback((nodeId: string, taskId: string | number, startTime: number, input: Record<string, unknown>, maxPollMs: number, onSuccess?: (resultUrl: string) => void) => {
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
            // 视频写 videoSrc、音频写 audioSrc、图片写 imageSrc
            updateNode(
              nodeId,
              isVideo ? { status: "success", videoSrc: primary }
                : isAudio ? { status: "success", audioSrc: primary }
                : { status: "success", imageSrc: primary, ...imageSize },
            );
            // 批量多图：resultMeta.urls 的其余张铺成新图片节点（仅图片）
            const taskMeta = parseTaskMeta(task.resultMeta);
            const rawUrls = taskMeta.urls;
            const urls = Array.isArray(rawUrls) ? rawUrls.filter((u): u is string => isValid(u as string)) : [];
            if (!isVideo && !isAudio && node && urls.length > 1) {
              spreadBatchNodes(store, node, urls.slice(1), requestedAspect);
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
  const generate = useCallback(async ({ nodeId, handler, modelId, input, onSuccess }: GenerateParams) => {
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
      pollTask(nodeId, res.data.id, Date.now(), input, maxPollMs, onSuccess);
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
