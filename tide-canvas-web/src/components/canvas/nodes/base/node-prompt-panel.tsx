"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Loader2, Maximize2, Sparkles, ChevronDown, Zap } from "lucide-react";
import { NodeChrome } from "./node-chrome";

const LINE_HEIGHT = 20;
const MIN_ROWS = 3;
const MAX_ROWS = 4;

interface Props {
  prompt: string;
  placeholder?: string;
  modelName?: string;
  generating: boolean;
  canSubmit: boolean;
  pointCost?: number;
  /** 顶部左侧的额外控件（如 风格 / 标记 / 时长 等） */
  topControls?: ReactNode;
  /** 底部工具栏中部的设置控件（如 比例 / 摄像机 / 全景 等） */
  middleControls?: ReactNode;
  /** 传入画布缩放 k 则启用「恒定大小·跟随节点」覆盖层模式；省略则保持旧的流式布局 */
  zoom?: number;
  /** 覆盖层模式下面板宽度（屏幕像素），默认 320 */
  overlayWidth?: number;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onStop: (e: React.MouseEvent) => void;
}

export function NodePromptPanel({
  prompt, placeholder, modelName = "默认模型",
  generating, canSubmit, pointCost = 18,
  topControls, middleControls,
  zoom, overlayWidth = 320,
  onPromptChange, onSubmit, onStop,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const minH = MIN_ROWS * LINE_HEIGHT;
    const maxH = MAX_ROWS * LINE_HEIGHT;
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, minH), maxH)}px`;
  }, [prompt]);

  const disabled = !canSubmit || generating;
  const overlay = zoom != null;

  const panel = (
    <div
      className="relative rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
      style={overlay ? { width: overlayWidth, boxSizing: "border-box" } : { boxSizing: "border-box" }}
    >
      {/* 顶部：左侧自定义控件 + 右侧展开按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">{topControls}</div>
        <button onMouseDown={onStop} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 提示词输入 */}
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onMouseDown={onStop}
        placeholder={placeholder}
        rows={MIN_ROWS}
        className="mt-3 block w-full resize-none border-0 bg-transparent text-sm leading-5 placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0"
        style={{
          cursor: "text",
          outline: "none",
          boxShadow: "none",
          maxHeight: `${MAX_ROWS * LINE_HEIGHT}px`,
          overflowY: "auto",
          overflowX: "hidden",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
          boxSizing: "border-box",
        }}
      />

      {/* 底部工具栏 */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <button onMouseDown={onStop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <Sparkles className="h-3 w-3 text-neutral-900 dark:text-neutral-100" />
            {modelName}
            <ChevronDown className="h-3 w-3" />
          </button>
          {middleControls}
          <span className="flex items-center gap-0.5 px-1 text-neutral-500">
            <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
            {pointCost}
          </span>
        </div>
        <button
          onMouseDown={onStop}
          onClick={(e) => { onStop(e); if (!disabled) onSubmit(); }}
          disabled={disabled}
          title={generating ? "生成中..." : "开始生成"}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            disabled
              ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
              : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          }`}
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );

  // 覆盖层模式：恒定屏幕尺寸，吸附在卡片正下方居中
  if (overlay) {
    return (
      <NodeChrome zoom={zoom} placement="bottom-center" gap={18}>
        {panel}
      </NodeChrome>
    );
  }

  // 流式模式（旧行为）：跟随卡片等比缩放
  return <div className="mt-3 w-full">{panel}</div>;
}
