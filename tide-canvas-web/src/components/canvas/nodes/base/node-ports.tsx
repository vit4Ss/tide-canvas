"use client";

import { Plus } from "lucide-react";
import { Handle, Position } from "@xyflow/react";
import { useIsReactFlowNode } from "@/features/canvas/infrastructure/react-flow/canvas-flow-context";
import { NodeChrome } from "./node-chrome";

interface Props {
  nodeId: string;
  visible: boolean;
  /** true 则启用「恒定大小·跟随节点」覆盖层模式；省略则保持旧的流式布局 */
  overlay?: boolean;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
  /** 端口悬浮提示（图片节点的文案更长，经此覆盖默认值） */
  inputTitle?: string;
  outputTitle?: string;
  input?: boolean;
  output?: boolean;
}

const PORT_VISUAL =
  "flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-400 shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md active:scale-95 dark:border-neutral-600 dark:bg-neutral-900";

export function NodePorts({
  nodeId,
  visible,
  overlay,
  onPortMouseDown,
  inputTitle = "输入端口",
  outputTitle = "输出端口",
  input: inputEnabled = true,
  output: outputEnabled = true,
}: Props) {
  const reactFlowNode = useIsReactFlowNode();
  if (!visible && !reactFlowNode) return null;

  const flowHandleClass = `${PORT_VISUAL} !relative !left-auto !right-auto !top-auto !bottom-auto !m-0 !min-h-6 !min-w-6 !translate-x-0 !translate-y-0 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`;

  const input = inputEnabled ? reactFlowNode ? (
    <Handle
      id="input"
      type="target"
      position={Position.Left}
      className={flowHandleClass}
      title={inputTitle}
      aria-label={inputTitle}
    >
      <Plus className="h-3 w-3" />
    </Handle>
  ) : (
    <button
      type="button"
      onMouseDown={(event) => { event.stopPropagation(); onPortMouseDown?.(nodeId, "input", event.clientX, event.clientY); }}
      className={PORT_VISUAL}
      title={inputTitle}
    >
      <Plus className="h-3 w-3" />
    </button>
  ) : null;
  const output = outputEnabled ? reactFlowNode ? (
    <Handle
      id="output"
      type="source"
      position={Position.Right}
      className={flowHandleClass}
      title={outputTitle}
      aria-label={outputTitle}
    >
      <Plus className="h-3 w-3" />
    </Handle>
  ) : (
    <button
      type="button"
      onMouseDown={(event) => { event.stopPropagation(); onPortMouseDown?.(nodeId, "output", event.clientX, event.clientY); }}
      className={PORT_VISUAL}
      title={outputTitle}
    >
      <Plus className="h-3 w-3" />
    </button>
  ) : null;

  // 覆盖层模式：恒定屏幕尺寸，吸附在卡片左/右缘中点
  if (overlay) {
    return (
      <>
        {input && <NodeChrome placement="left" gap={12}>{input}</NodeChrome>}
        {output && <NodeChrome placement="right" gap={12}>{output}</NodeChrome>}
      </>
    );
  }

  // 流式模式（旧行为）：绝对定位贴在卡片左右缘外侧
  return (
    <>
      {input && <div className="absolute right-full top-1/2 z-10 mr-3 -translate-y-1/2">{input}</div>}
      {output && <div className="absolute left-full top-1/2 z-10 ml-3 -translate-y-1/2">{output}</div>}
    </>
  );
}
