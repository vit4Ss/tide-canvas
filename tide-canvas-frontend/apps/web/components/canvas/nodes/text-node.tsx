"use client";

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Card, Resizable, TextArea } from "@douyinfe/semi-ui";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { aiApi } from "@/lib/api";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import {
  AlignLeft,
  ArrowDownRight,
  ArrowUp,
  Download,
  Image as ImageIcon,
  Languages,
  Loader2,
  Music2,
  Play,
  Text,
  Zap,
} from "lucide-react";
import { toast } from "@/components/shared/toast";
import { NodeHeader } from "./base/node-header";
import { NodeChrome } from "./base/node-chrome";
import { ModelPicker } from "./model-picker";
import {
  buildTextNodeGenerationPrompt,
  normalizeTextNodeOutput,
  parseTaskTextResult,
  TEXT_NODE_HANDLER,
} from "./text-node-output";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
}

const TEXT_CARD_WIDTH = 440;
const TEXT_CARD_HEIGHT = 360;
const PANEL_WIDTH = 640;
const TEXT_POLL_INTERVAL = 1200;
const TEXT_POLL_TIMEOUT = 120_000;

const SUGGESTIONS = [
  { label: "自己编写内容", icon: Text, prompt: "" },
  { label: "文生视频", icon: Play, prompt: "文生视频：" },
  { label: "图片反推提示词", icon: ImageIcon, prompt: "图片反推提示词：" },
  { label: "文字生音乐", icon: Music2, prompt: "文字生音乐：" },
];

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function modelSupportsHandler(model: AiModelVO) {
  return !model.supportedHandlers?.length || model.supportedHandlers.includes(TEXT_NODE_HANDLER);
}

function toNumericSize(value: string | number | undefined, fallback: number) {
  if (typeof value === "number") return value;
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const TextNode = memo(function TextNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
}: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const zoom = useCanvasStore((s) => s.transform.k);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const isMultiSelect = useCanvasStore((s) => s.selectedNodeIds.size > 1);
  const showAuxUI = isSelected && !isDragging && !isMultiSelect;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const resizeActiveRef = useRef(false);

  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [handlerCost, setHandlerCost] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(1);
  const pushHistory = useCanvasStore((s) => s.pushHistory);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showAuxUI) return;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [showAuxUI]);

  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (!active || !res.success) return;
      const enabled = res.data ?? [];
      const handlerModels = enabled.filter(modelSupportsHandler);
      const textModels = enabled.filter((model) => model.type === AiModelType.TEXT);
      const usable = textModels.length ? textModels : handlerModels.length ? handlerModels : enabled;
      setModels(usable);
      if (usable.length) setSelectedModelId((current) => current || usable[0].modelId);
    }).catch(() => {});

    aiApi.listHandlers().then((res) => {
      if (!active || !res.success) return;
      const handler = res.data.find((item) => item.handlerName === TEXT_NODE_HANDLER);
      setHandlerCost(handler?.pointCost ?? null);
    }).catch(() => {});

    return () => { active = false; };
  }, []);

  const selectedModel = models.find((model) => model.modelId === selectedModelId) || models[0];
  const prompt = node.prompt || "";
  const outputText = node.textOutput?.trim() || "";
  const isGenerating = sending || node.status === "generating";
  const canSubmit = prompt.trim().length > 0 && !isGenerating;
  const pointCost = Number(selectedModel?.pointCost ?? handlerCost ?? 1);
  const cardWidth = Math.max(node.contentW ?? node.width ?? TEXT_CARD_WIDTH, TEXT_CARD_WIDTH);
  const cardHeight = Math.max(node.contentH ?? node.height ?? TEXT_CARD_HEIGHT, TEXT_CARD_HEIGHT);

  const updateNodeSize = useCallback((size: { width?: string | number; height?: string | number }) => {
    const nextWidth = Math.max(TEXT_CARD_WIDTH, Math.round(toNumericSize(size.width, cardWidth)));
    const nextHeight = Math.max(TEXT_CARD_HEIGHT, Math.round(toNumericSize(size.height, cardHeight)));
    updateNode(node.id, {
      width: nextWidth,
      height: nextHeight,
      contentW: nextWidth,
      contentH: nextHeight,
    }, false);
  }, [cardHeight, cardWidth, node.id, updateNode]);

  useEffect(() => {
    if (!isGenerating) {
      setProgress(1);
      return;
    }
    setProgress(1);
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(92, current + (current < 30 ? 7 : current < 65 ? 4 : 2)));
    }, 800);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  const stop = (event: MouseEvent) => event.stopPropagation();

  const handleSuggestion = (value: string) => {
    if (value) updateNode(node.id, { prompt: value, textError: undefined }, false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const waitForTask = useCallback(async (task: AiTaskVO) => {
    let current = task;
    const started = Date.now();

    while (current.status === AiTaskStatus.PROCESSING) {
      if (Date.now() - started > TEXT_POLL_TIMEOUT) {
        throw new Error("文本生成超时，请重试");
      }
      await delay(TEXT_POLL_INTERVAL);
      const res = await aiApi.getTask(current.id);
      if (!res.success) throw new Error(res.message || "文本生成失败");
      current = res.data;
    }

    if (current.status === AiTaskStatus.FAILED || current.status === AiTaskStatus.CANCELLED) {
      throw new Error(current.errorMsg || "文本生成失败");
    }
    return current;
  }, []);

  const generateText = useCallback(async () => {
    const sourcePrompt = prompt.trim();
    if (!sourcePrompt || isGenerating) return;

    setSending(true);
    updateNode(node.id, { status: "generating", textError: undefined }, false);
    try {
      const res = await aiApi.generate({
        handler: TEXT_NODE_HANDLER,
        modelId: selectedModel?.modelId || selectedModelId || "default",
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
        input: {
          prompt: buildTextNodeGenerationPrompt(sourcePrompt),
        },
      });
      if (!res.success) throw new Error(res.message || "文本生成请求失败");

      const task = await waitForTask(res.data);
      const rawText = parseTaskTextResult(task);
      const output = normalizeTextNodeOutput(rawText, sourcePrompt);
      if (!output.actionInput.trim()) throw new Error("文本模型没有返回有效内容");

      updateNode(node.id, {
        status: "success",
        prompt: sourcePrompt,
        textOutput: output.display,
        textAction: output.action,
        textActionInput: output.actionInput,
        textSupplementary: JSON.stringify(output.supplementary),
        textError: undefined,
        ...(output.aspectRatio ? { aspectRatio: output.aspectRatio } : {}),
      }, true);
      toast.success("文本节点生成完成");
    } catch (error) {
      const message = (error as Error)?.message || "文本生成失败";
      updateNode(node.id, { status: outputText ? "success" : "error", textError: message }, false);
      toast.error(message);
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [currentProjectId, isGenerating, node.id, outputText, prompt, selectedModel?.modelId, selectedModelId, updateNode, waitForTask]);

  const handlePromptChange = useCallback((value: string) => {
    updateNode(node.id, {
      prompt: value,
      ...(node.status === "error" ? { status: outputText ? "success" : "idle", textError: undefined } : {}),
    });
  }, [node.id, node.status, outputText, updateNode]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void generateText();
    }
  };

  const downloadOutput = (event: MouseEvent) => {
    stop(event);
    if (!outputText) return;
    const blob = new Blob([outputText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${node.title || "text-node"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-node-id={node.id}
      className={`relative select-none ${isSelected ? "z-10" : ""}`}
      style={{ width: cardWidth, cursor: isDragging ? "grabbing" : "grab" }}
    >
      <div className="relative">
        <Resizable
          size={{ width: cardWidth, height: cardHeight }}
          minWidth={TEXT_CARD_WIDTH}
          minHeight={TEXT_CARD_HEIGHT}
          maxWidth={900}
          maxHeight={760}
          scale={zoom}
          enable={showAuxUI ? {
            top: false,
            right: false,
            bottom: false,
            left: false,
            topRight: false,
            bottomRight: true,
            bottomLeft: false,
            topLeft: false,
          } : false}
          handleNode={{
            bottomRight: (
              <span
                aria-hidden="true"
                onMouseDown={stop}
                className="flex h-7 w-7 items-center justify-center rounded-br-3xl text-neutral-400 transition-colors hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-200"
              >
                <ArrowDownRight className="h-3.5 w-3.5" />
              </span>
            ),
          }}
          handleStyle={{ bottomRight: { right: 5, bottom: 5, width: 28, height: 28, zIndex: 6 } }}
          onResizeStart={(event) => {
            if ("stopPropagation" in event) event.stopPropagation();
            if (!resizeActiveRef.current) {
              pushHistory();
              resizeActiveRef.current = true;
            }
          }}
          onChange={(size) => updateNodeSize(size)}
          onResizeEnd={(size) => {
            updateNodeSize(size);
            resizeActiveRef.current = false;
          }}
          style={{ width: cardWidth, height: cardHeight }}
        >
          <Card
            bordered={false}
            shadows="hover"
            aria-label={node.title || "文本节点"}
            data-node-selected={isSelected && !isConnectTarget ? "true" : undefined}
            bodyStyle={{ height: "100%", padding: 0 }}
            className={`canvas-node-selection-surface relative h-full w-full overflow-hidden rounded-3xl bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
              isConnectTarget ? "ring-2 ring-blue-500/70" :
              "ring-transparent"
            }`}
            style={{ height: "100%" }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(0,0,0,0.025),transparent_34%)] dark:bg-[radial-gradient(circle_at_50%_8%,rgba(255,255,255,0.04),transparent_34%)]" />

            <div className="relative flex h-full flex-col items-center px-7 pb-8 pt-10 text-neutral-900 dark:text-neutral-100">
              {isGenerating ? (
                <div className="flex h-full w-full flex-col justify-between pt-2">
                  <div className="space-y-3">
                    {[88, 100, 98, 92, 100, 96, 72, 92, 62, 48].map((width, index) => (
                      <div
                        key={index}
                        className="h-2.5 rounded-full bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 dark:from-neutral-800 dark:via-neutral-700 dark:to-neutral-800"
                        style={{ width: `${width}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-center">
                    <span className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-900 shadow-md shadow-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                      生成中 {progress}%...
                    </span>
                  </div>
                </div>
              ) : outputText ? (
                <TextArea
                  readonly
                  value={outputText}
                  autosize={false}
                  resize="none"
                  onMouseDown={stop}
                  className="mt-1 h-full w-full rounded-xl border border-neutral-200 bg-white/80 text-sm leading-6 text-neutral-950 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-100"
                  textareaStyle={{
                    height: "100%",
                    padding: 16,
                    cursor: "text",
                    whiteSpace: "pre-wrap",
                    overflowY: "auto",
                    overflowX: "hidden",
                    resize: "none",
                    boxShadow: "none",
                    outline: "none",
                  }}
                />
              ) : (
                <>
                  <div className="flex h-20 items-center justify-center text-neutral-400 dark:text-neutral-600" aria-hidden="true">
                    <div className="space-y-2">
                      <div className="h-2 w-[70px] rounded-sm bg-current" />
                      <div className="h-2 w-[70px] rounded-sm bg-current" />
                      <div className="h-2 w-[70px] rounded-sm bg-current" />
                      <div className="h-2 w-10 rounded-sm bg-current" />
                    </div>
                  </div>

                  <div className="mt-6 w-full max-w-[310px] self-start">
                    <p className="mb-4 text-sm text-neutral-800 dark:text-neutral-200">尝试：</p>
                    <div className="space-y-3">
                      {SUGGESTIONS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            onMouseDown={stop}
                            onClick={(event) => { stop(event); handleSuggestion(item.prompt); }}
                            className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[15px] leading-none text-neutral-950 transition-colors hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-900"
                          >
                            <Icon className="h-4 w-4 shrink-0 fill-neutral-950 stroke-neutral-950 dark:fill-neutral-100 dark:stroke-neutral-100" />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </Resizable>

        <NodeHeader icon={AlignLeft} title={node.title || "文本节点"} visible={showAuxUI} zoom={zoom} />

        {showAuxUI && outputText && !isGenerating && (
          <NodeChrome zoom={zoom} placement="top-center" gap={12} damp={0.6}>
            <button
              onMouseDown={stop}
              onClick={downloadOutput}
              title="下载文本输出"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-lg shadow-neutral-900/10 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Download className="h-4 w-4" />
            </button>
          </NodeChrome>
        )}

        {showAuxUI && (
          <NodeChrome zoom={zoom} placement="bottom-center" gap={18} damp={0.6}>
            <div
              onMouseDown={stop}
              className="canvas-node-composer flex flex-col rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
              style={{ width: PANEL_WIDTH, boxSizing: "border-box" }}
            >
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => handlePromptChange(event.target.value)}
                onMouseDown={stop}
                onKeyDown={handlePromptKeyDown}
                placeholder="描述你想要规划的内容，例如：一个来自未来的机器人，坐在天台上看星星"
                rows={3}
                className="block w-full resize-none border-0 bg-transparent text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100"
                style={{
                  cursor: "text",
                  outline: "none",
                  boxShadow: "none",
                  minHeight: 72,
                  maxHeight: 112,
                  overflowY: "auto",
                  overflowX: "hidden",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  boxSizing: "border-box",
                }}
              />

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={models} value={selectedModel?.modelId || selectedModelId} onChange={setSelectedModelId} />
                </div>

                <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <span className="flex h-8 items-center justify-center rounded-md px-1.5 text-neutral-800 dark:text-neutral-100" title="结构化整理">
                    <Languages className="h-4 w-4" />
                  </span>
                  <span className="flex h-8 items-center gap-1 rounded-full px-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100" title="本次调用消耗积分">
                    <Zap className="h-3.5 w-3.5 fill-current text-neutral-900 dark:text-neutral-100" />
                    {Number.isFinite(pointCost) ? pointCost : 1}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(event) => { stop(event); void generateText(); }}
                    disabled={!canSubmit}
                    aria-label="生成文本规划"
                    title={isGenerating ? "生成中..." : "生成文本规划"}
                    className={"flex h-8 w-8 items-center justify-center rounded-lg transition-colors " + (
                      canSubmit
                        ? "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                        : "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                    )}
                  >
                    {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
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
