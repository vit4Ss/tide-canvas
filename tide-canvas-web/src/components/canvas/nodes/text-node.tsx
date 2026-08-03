"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { aiApi } from "@/lib/api";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import {
  AlignLeft,
  ArrowUp,
  Image as ImageIcon,
  Loader2,
  Music2,
  Play,
  Text,
  Zap,
} from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodeChrome } from "./base/node-chrome";
import { ModelPicker } from "./model-picker";
import { CanvasSkillRunNodeShortcut } from "../skill-run/canvas-skill-run-workspace";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

const TEXT_CARD_WIDTH = 440;
const TEXT_CARD_HEIGHT = 440;
const PANEL_WIDTH = 560;

const SUGGESTIONS = [
  { label: "自己编写内容", icon: Text, prompt: "" },
  { label: "文生视频", icon: Play, prompt: "写一段适合生成视频的故事分镜：" },
  { label: "图片反推提示词", icon: ImageIcon, prompt: "根据图片内容，反推一段清晰、可用于生成图片的提示词：" },
  { label: "文字生音乐", icon: Music2, prompt: "写一段适合生成音乐的歌词或氛围描述：" },
];

export const TextNode = memo(function TextNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
  onNodeMouseDown,
  onPortMouseDown,
}: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const isMultiSelect = useCanvasStore((s) => s.selectedNodeIds.size > 1);
  const showAuxUI = isSelected && !isDragging && !isMultiSelect;

  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelId, setModelId] = useState("");
  const { generate, isGenerating } = useAiGeneration();
  const generating = node.status === "generating" || isGenerating(node.id);

  useEffect(() => {
    if (node.width !== TEXT_CARD_WIDTH || node.height !== TEXT_CARD_HEIGHT) {
      updateNode(node.id, { width: TEXT_CARD_WIDTH, height: TEXT_CARD_HEIGHT }, false);
    }
  }, [node.height, node.id, node.width, updateNode]);

  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (!active || !res.success) return;
      const textModels = res.data.filter((m) => m.type === AiModelType.TEXT);
      setModels(textModels);
      if (textModels.length) setModelId((prev) => prev || textModels[0].modelId);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const selectedModel = models.find((m) => m.modelId === modelId) || models[0];
  const prompt = node.prompt || "";
  const canSubmit = prompt.trim().length > 0;
  const pointCost = Number(selectedModel?.pointCost ?? 6);
  const cardWidth = Math.max(node.width, TEXT_CARD_WIDTH);
  const cardHeight = Math.max(node.contentH ?? node.height, TEXT_CARD_HEIGHT);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // 鼠标在可滚区域上滚动时，若内容可滚则滚内容、不冒泡到画布。画布平移用的是
  // 原生冒泡 wheel 监听且会 preventDefault,先于 React 合成 onWheel 执行——
  // React 的 onWheel stopPropagation 根本拦不住,必须在元素上挂原生 listener
  // (同 prompt-ref-editor 的做法),否则生成的长文滚不动、滚轮只会平移画布。
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const promptTaRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = !!node.content;
  useEffect(() => {
    const els: HTMLElement[] = [];
    if (contentScrollRef.current) els.push(contentScrollRef.current);
    if (promptTaRef.current) els.push(promptTaRef.current);
    const bound = els.map((el) => {
      const onWheel = (e: WheelEvent) => {
        if (el.scrollHeight > el.clientHeight) e.stopPropagation();
      };
      el.addEventListener("wheel", onWheel, { passive: true });
      return { el, onWheel };
    });
    return () => bound.forEach(({ el, onWheel }) => el.removeEventListener("wheel", onWheel));
  }, [hasContent, showAuxUI]);

  const handleSuggestion = (value: string) => {
    if (!value) return;
    updateNode(node.id, { prompt: value }, false);
  };

  // 与 AI 助手面板同一条链路：assistant_chat handler + relay 文本模型，结果经
  // use-ai-generation 的文本分支写回 node.content
  const handleGenerate = () => {
    if (!canSubmit || generating) return;
    generate({
      nodeId: node.id,
      handler: "assistant_chat",
      modelId: selectedModel?.modelId || "default",
      input: { prompt: prompt.trim() },
    });
  };

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: cardWidth, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
    >
      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70" :
            isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600" : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ height: cardHeight }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(0,0,0,0.025),transparent_34%)] dark:bg-[radial-gradient(circle_at_50%_8%,rgba(255,255,255,0.04),transparent_34%)]" />

          {node.content ? (
            // 已选中时内容可划选复制（mousedown 不再进入节点拖拽）；未选中时首次点击仍是选中/拖动节点。
            // 拖动已选中的节点用标题栏或卡片边缘。
            <div
              ref={contentScrollRef}
              onMouseDown={isSelected ? stop : undefined}
              className={`relative h-full overflow-y-auto px-7 py-6 text-neutral-900 dark:text-neutral-100 ${
                isSelected ? "cursor-text select-text" : ""
              }`}
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-7">{node.content}</p>
            </div>
          ) : (
          <div className="relative flex h-full flex-col items-center px-7 pb-8 pt-12 text-neutral-900 dark:text-neutral-100">
            <div className="flex h-20 items-center justify-center text-neutral-400 dark:text-neutral-600" aria-hidden="true">
              <div className="space-y-2">
                <div className="h-2 w-[70px] rounded-sm bg-current" />
                <div className="h-2 w-[70px] rounded-sm bg-current" />
                <div className="h-2 w-[70px] rounded-sm bg-current" />
                <div className="h-2 w-10 rounded-sm bg-current" />
              </div>
            </div>

            <div className="mt-8 w-full max-w-[310px] self-start">
              <p className="mb-4 text-base text-neutral-800 dark:text-neutral-200">尝试：</p>
              <div className="space-y-4">
                {SUGGESTIONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onMouseDown={stop}
                      onClick={(e) => { stop(e); handleSuggestion(item.prompt); }}
                      className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[18px] leading-none text-neutral-950 transition-colors hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0 fill-neutral-950 stroke-neutral-950 dark:fill-neutral-100 dark:stroke-neutral-100" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          )}

          {generating && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/75 text-sm text-neutral-500 dark:bg-neutral-950/75 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在生成...
            </div>
          )}
        </div>

        <NodeHeader icon={AlignLeft} title={node.title || "文本节点"} visible={showAuxUI} overlay />
        <NodePorts nodeId={node.id} visible={showAuxUI} overlay onPortMouseDown={onPortMouseDown} />
        <CanvasSkillRunNodeShortcut nodeId={node.id} nodeType={node.type} visible={showAuxUI} />

        {showAuxUI && (
          <NodeChrome placement="bottom-center" gap={18} damp={0.6}>
            <div
              onMouseDown={stop}
              className="flex flex-col rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
              style={{ width: PANEL_WIDTH, boxSizing: "border-box" }}
            >
              <textarea
                ref={promptTaRef}
                value={prompt}
                onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
                onMouseDown={stop}
                placeholder="写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。"
                rows={3}
                className="block w-full select-text resize-none border-0 bg-transparent text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100"
                style={{
                  cursor: "text",
                  outline: "none",
                  boxShadow: "none",
                  minHeight: 60,
                  maxHeight: 96,
                  overflowY: "auto",
                  overflowX: "hidden",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  boxSizing: "border-box",
                }}
              />

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ModelPicker models={models} value={selectedModel?.modelId || ""} onChange={setModelId} />
                </div>

                <div className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
                  <span className="flex h-8 items-center gap-1 rounded-full px-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100" title="本次生成消耗积分">
                    <Zap className="h-3.5 w-3.5 fill-current text-neutral-900 dark:text-neutral-100" />
                    {pointCost}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); handleGenerate(); }}
                    disabled={!canSubmit || generating}
                    title={generating ? "生成中..." : !canSubmit ? "先输入提示词" : "生成文本"}
                    className={"flex h-8 w-8 items-center justify-center rounded-full transition-colors " + (
                      canSubmit && !generating
                        ? "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                        : "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                    )}
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </NodeChrome>
        )}
      </div>
    </div>
  );
});
