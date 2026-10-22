"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { aiApi } from "@/lib/api";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelType } from "@/types/ai";
import { createCanvasModelCatalog, resolveCanvasModelId } from "@/lib/canvas-model-catalog";

const canvasModelCatalog = createCanvasModelCatalog(aiApi.listModels);

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

/** 把卡片实际渲染尺寸同步到 store，供连线层将端点锚定到卡片真实边缘中点（默认对节点居中）。
 *  updateNode 默认不记历史；条件守卫确保仅在值变化时写入，自然收敛、不会循环。 */
export function useSyncContentSize(node: CanvasNode, w: number, h: number) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  useEffect(() => {
    if (node.contentW !== w || node.contentH !== h) {
      updateNode(node.id, { contentW: w, contentH: h });
    }
  }, [w, h, node.contentW, node.contentH, node.id, updateNode]);
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
  const catalog = useSyncExternalStore(canvasModelCatalog.subscribe, canvasModelCatalog.getSnapshot, canvasModelCatalog.getServerSnapshot);
  const models = useMemo(() => catalog.models.filter((model) => model.type === type), [catalog.models, type]);
  const [modelId, setModelId] = useState(preferredModelId ?? "");
  const requestRevision = useRef(0);
  useEffect(() => {
    const request = ++requestRevision.current;
    void canvasModelCatalog.load().then((result) => {
      if (request === requestRevision.current && result.status === "ready") {
        const filtered = result.models.filter((model) => model.type === type);
        setModelId((current) => resolveCanvasModelId(filtered, current, preferredModelId));
      }
    });
    return () => { requestRevision.current += 1; };
  }, [preferredModelId, type]);

  const reload = useCallback(() => {
    const request = ++requestRevision.current;
    void canvasModelCatalog.reload().then((result) => {
      if (request === requestRevision.current && result.status === "ready") {
        const filtered = result.models.filter((model) => model.type === type);
        setModelId((current) => resolveCanvasModelId(filtered, current, preferredModelId));
      }
    });
  }, [preferredModelId, type]);
  const resolvedModelId = resolveCanvasModelId(models, modelId, preferredModelId);
  const selectedModel = models.find((model) => model.modelId === resolvedModelId);
  return { models, modelId: resolvedModelId, setModelId, selectedModel, status: catalog.status, error: catalog.error, reload };
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
