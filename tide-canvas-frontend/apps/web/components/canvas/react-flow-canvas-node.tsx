"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CanvasNodeComponent } from "./canvas-node";
import type { CanvasNode } from "@/stores/use-canvas-store";

export type TideFlowNode = Node<{ node: CanvasNode }, "tideCanvasNode">;

const handleBase =
  "!h-5 !w-5 !rounded-full !border !border-neutral-300 !bg-white !text-neutral-500 !shadow-none !transition-all hover:!scale-105 hover:!border-blue-500 hover:!bg-blue-50 dark:!border-neutral-700 dark:!bg-neutral-900";

const FLOAT_GAP = 16;

export const ReactFlowCanvasNode = memo(function ReactFlowCanvasNode({
  data,
  selected,
  dragging,
  isConnectable,
}: NodeProps<TideFlowNode>) {
  const node = data.node;
  const width = node.contentW ?? node.width;
  const height = node.contentH ?? node.height;

  return (
    <div className="group relative" style={{ width, height }}>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className={handleBase}
        style={{ left: -FLOAT_GAP, right: "auto", top: "50%", transform: "translate(-50%, -50%)", zIndex: 20 }}
      />
      <CanvasNodeComponent
        node={node}
        isSelected={selected}
        isDragging={dragging}
        isConnectTarget={false}
      />
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className={handleBase}
        style={{ left: "auto", right: -FLOAT_GAP, top: "50%", transform: "translate(50%, -50%)", zIndex: 20 }}
      />
    </div>
  );
});
