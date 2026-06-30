"use client";

import { Plus } from "lucide-react";
import { NodeChrome } from "./node-chrome";

interface Props {
  nodeId: string;
  visible: boolean;
  /** 传入画布缩放 k 则启用「恒定大小·跟随节点」覆盖层模式；省略则保持旧的流式布局 */
  zoom?: number;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

const PORT_VISUAL =
  "flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-400 shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md active:scale-95 dark:border-neutral-600 dark:bg-neutral-900";

export function NodePorts({ nodeId, visible, zoom, onPortMouseDown }: Props) {
  if (!visible) return null;

  const input = (
    <button
      onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(nodeId, "input", e.clientX, e.clientY); }}
      className={PORT_VISUAL}
      title="输入端口"
    >
      <Plus className="h-3 w-3" />
    </button>
  );
  const output = (
    <button
      onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(nodeId, "output", e.clientX, e.clientY); }}
      className={PORT_VISUAL}
      title="输出端口"
    >
      <Plus className="h-3 w-3" />
    </button>
  );

  // 覆盖层模式：恒定屏幕尺寸，吸附在卡片左/右缘中点
  if (zoom != null) {
    return (
      <>
        <NodeChrome zoom={zoom} placement="left" gap={12}>{input}</NodeChrome>
        <NodeChrome zoom={zoom} placement="right" gap={12}>{output}</NodeChrome>
      </>
    );
  }

  // 流式模式（旧行为）：绝对定位贴在卡片左右缘外侧
  return (
    <>
      <div className="absolute right-full top-1/2 z-10 mr-3 -translate-y-1/2">{input}</div>
      <div className="absolute left-full top-1/2 z-10 ml-3 -translate-y-1/2">{output}</div>
    </>
  );
}
