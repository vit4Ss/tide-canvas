"use client";

import { useCallback, useRef, useState } from "react";
import { aiApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import type { AiTaskVO, AiGenerateDTO } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";
import { toast } from "@/components/shared/toast";

interface GenerateParams {
  nodeId: string;
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
}

const POLL_INTERVAL = 2000; // 2 秒轮询
const MAX_POLL_TIME = 5 * 60 * 1000; // 最多 5 分钟

export function useAiGeneration() {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const [activeTaskIds, setActiveTaskIds] = useState<Set<string>>(new Set());
  const pollTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /** 轮询任务状态直到完成 */
  const pollTask = useCallback((nodeId: string, taskId: string | number, startTime: number) => {
    const poll = async () => {
      // 超时检查
      if (Date.now() - startTime > MAX_POLL_TIME) {
        updateNode(nodeId, { status: "error" });
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
          updateNode(nodeId, { status: "error" });
          toast.error(res.message || "生成失败");
          return;
        }
        const task: AiTaskVO = res.data;
        if (task.status === AiTaskStatus.SUCCESS) {
          updateNode(nodeId, {
            status: "success",
            imageSrc: task.resultUrl || undefined,
          });
          toast.success("生成成功");
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        } else if (task.status === AiTaskStatus.FAILED) {
          updateNode(nodeId, { status: "error" });
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
        updateNode(nodeId, { status: "error" });
        toast.error("网络错误");
        setActiveTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    };
    poll();
  }, [updateNode]);

  /** 开始生成 */
  const generate = useCallback(async ({ nodeId, handler, modelId, input }: GenerateParams) => {
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
        updateNode(nodeId, { status: "error" });
        toast.error(res.message || "生成请求失败");
        setActiveTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        return;
      }
      // 启动轮询
      pollTask(nodeId, res.data.id, Date.now());
    } catch {
      updateNode(nodeId, { status: "error" });
      toast.error("网络错误");
      setActiveTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [activeTaskIds, updateNode, pollTask, currentProjectId]);

  const isGenerating = useCallback((nodeId: string) => activeTaskIds.has(nodeId), [activeTaskIds]);

  return { generate, isGenerating };
}
