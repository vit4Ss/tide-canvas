"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { aiApi } from "@/lib/api";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelType, AiModelVO } from "@/types/ai";

/** 卸载守卫:异步探测/上传回调完成时若节点已卸载,不再 setState。
 *  挂载时须重新置 true:StrictMode 会 mount→unmount→remount,只在 cleanup
 *  置 false 会让 ref 在重挂载后永远为 false。 */
export function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  return mountedRef;
}

/** 媒体节点共用的运行态：画布级生成轮询接线 + 多选/选中推导的辅助 UI 可见性 */
export function useNodeRuntime(node: CanvasNode, isSelected: boolean, isDragging: boolean) {
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";
  // 多选时隐藏单节点辅助 UI（工具栏/端口/输入框等），仅保留选中边框
  const isMultiSelect = useCanvasStore((s) => s.selectedNodeIds.size > 1);
  // 仅选中且非拖动状态下显示辅助 UI
  const showAuxUI = isSelected && !isDragging && !isMultiSelect;
  return { generate, isGenerating, generating, isMultiSelect, showAuxUI };
}

const NODE_SIZE_TRANSITION_MS = 200;

interface PendingCenteredResize {
  startedAt: number;
  startWidth: number;
  startHeight: number;
  centerY: number;
  targetWidth: number;
  targetHeight: number;
}

/**
 * 比例切换专用的尺寸协调器。用同一条 200ms ease-out 时间线更新卡片宽高、
 * 节点坐标和连线锚点，因此横竖比例切换时视觉中心固定，边线也不会脱离卡片。
 */
export function useCenteredNodeResize(node: CanvasNode, width: number, height: number) {
  const [transitioning, setTransitioning] = useState(false);
  const pendingRef = useRef<PendingCenteredResize | null>(null);
  const frameRef = useRef<number | null>(null);
  const animationStepRef = useRef<(timestamp: number) => void>(() => undefined);

  const commitPendingResize = useCallback((resetVisualState: boolean): void => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const store = useCanvasStore.getState();
    const current = store.nodes.find((item) => item.id === node.id);
    if (current) {
      store.updateNode(node.id, {
        y: pending.centerY - pending.targetHeight / 2,
        contentW: pending.targetWidth,
        contentH: pending.targetHeight,
      });
    }
    if (resetVisualState) setTransitioning(false);
  }, [node.id]);

  const animateResize = useCallback((timestamp: number): void => {
    const pending = pendingRef.current;
    if (!pending) return;
    const progress = Math.min(1, Math.max(0, (timestamp - pending.startedAt) / NODE_SIZE_TRANSITION_MS));
    const eased = 1 - Math.pow(1 - progress, 3);
    const animatedWidth = pending.startWidth
      + (pending.targetWidth - pending.startWidth) * eased;
    const animatedHeight = pending.startHeight
      + (pending.targetHeight - pending.startHeight) * eased;
    const store = useCanvasStore.getState();
    if (!store.nodes.some((item) => item.id === node.id)) {
      pendingRef.current = null;
      frameRef.current = null;
      return;
    }
    store.updateNode(node.id, {
      y: pending.centerY - animatedHeight / 2,
      contentW: animatedWidth,
      contentH: animatedHeight,
    });
    if (progress >= 1) {
      pendingRef.current = null;
      frameRef.current = null;
      setTransitioning(false);
      return;
    }
    frameRef.current = requestAnimationFrame(animationStepRef.current);
  }, [node.id]);

  useEffect(() => {
    animationStepRef.current = animateResize;
  }, [animateResize]);

  const beginCenteredResize = useCallback((targetWidth: number, targetHeight: number): void => {
    if (targetWidth === width && targetHeight === height) return;
    const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
    if (!currentNode) return;
    const startWidth = currentNode.contentW ?? width;
    const startHeight = currentNode.contentH ?? height;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    pendingRef.current = {
      startedAt: performance.now(),
      startWidth,
      startHeight,
      centerY: currentNode.y + startHeight / 2,
      targetWidth,
      targetHeight,
    };

    const reduceMotion = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      commitPendingResize(true);
      return;
    }
    setTransitioning(true);
    frameRef.current = requestAnimationFrame(animateResize);
  }, [animateResize, commitPendingResize, height, node.id, width]);

  // 初始化、图片自然比例变化等非手动切换仍要立即同步；手动切换由上面的事务收尾。
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending) {
      if (pending.targetWidth !== width || pending.targetHeight !== height) {
        const currentNode = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
        const startWidth = currentNode?.contentW ?? pending.startWidth;
        const startHeight = currentNode?.contentH ?? pending.startHeight;
        pending.startedAt = performance.now();
        pending.startWidth = startWidth;
        pending.startHeight = startHeight;
        pending.centerY = (currentNode?.y ?? node.y) + startHeight / 2;
        pending.targetWidth = width;
        pending.targetHeight = height;
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(animateResize);
      }
      return;
    }
    if (node.contentW !== width || node.contentH !== height) {
      useCanvasStore.getState().updateNode(node.id, { contentW: width, contentH: height });
    }
  }, [animateResize, height, node.contentH, node.contentW, node.id, node.y, width]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    // 组件在过渡中卸载时也提交最终几何，避免持久化 aspectRatio 与 contentH 不一致。
    commitPendingResize(false);
  }, [commitPendingResize]);

  const displayWidth = transitioning ? node.contentW ?? width : width;
  const displayHeight = transitioning ? node.contentH ?? height : height;

  const containerStyle = useMemo<CSSProperties>(() => ({
    left: "50%",
    width: displayWidth,
    transform: "translateX(-50%)",
    willChange: transitioning ? "width" : undefined,
  }), [displayWidth, transitioning]);

  return {
    beginCenteredResize,
    containerStyle,
    displayWidth,
    displayHeight,
    transitioning,
  };
}

/** 已有结果却仍挂着 error 状态（如重发成功后旧标记残留）→ 收敛回 success */
export function useMediaErrorRecovery(node: CanvasNode, mediaSrc: string | undefined, generating: boolean) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  useEffect(() => {
    if (mediaSrc && node.status === "error" && !generating && !node.uploading) {
      updateNode(node.id, { status: "success" });
    }
  }, [generating, mediaSrc, node.id, node.status, node.uploading, updateNode]);
}

/** 拉取指定类型的可用模型（后台配置，含图标与支持的格式），默认选第一个 */
export function useAiModels(type: AiModelType, preferredModelId?: string) {
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelId, setModelId] = useState(preferredModelId ?? "");
  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (active && res.success) {
        const filtered = res.data.filter((m) => m.type === type);
        setModels(filtered);
        if (filtered.length > 0) {
          setModelId((prev) => {
            if (prev && filtered.some((model) => model.modelId === prev)) return prev;
            if (preferredModelId && filtered.some((model) => model.modelId === preferredModelId)) {
              return preferredModelId;
            }
            return filtered[0].modelId;
          });
        } else {
          setModelId("");
        }
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [preferredModelId, type]);
  const selectedModel = models.find((m) => m.modelId === modelId);
  return { models, modelId, setModelId, selectedModel };
}

/** 提示词编辑态：富文本展开弹窗开关 + 写回 store。
 *  commit 默认不记历史（updateNode 默认口径），error 且有结果时改提示词即收敛回 success。 */
export function useNodePrompt(node: CanvasNode, mediaSrc: string | undefined) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const handlePromptChange = useCallback((value: string) => {
    updateNode(node.id, {
      prompt: value,
      ...(node.status === "error" ? { status: mediaSrc ? "success" : "idle" } : {}),
    });
  }, [node.id, node.status, mediaSrc, updateNode]);
  return { promptExpanded, setPromptExpanded, handlePromptChange };
}
