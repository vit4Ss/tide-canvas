"use client";

import { memo, useCallback } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { AlignLeft } from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

export const TextNode = memo(function TextNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const showAuxUI = isSelected && !isDragging;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={AlignLeft} title={node.title || "文本节点"} visible={showAuxUI} />

      <div className="relative">
        <div
          className={`relative rounded-2xl border bg-white p-4 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ minHeight: 160 }}
        >
          <textarea
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
            onMouseDown={stop}
            placeholder="输入文本内容..."
            className="w-full resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0"
            style={{ outline: "none", boxShadow: "none", minHeight: 130, cursor: "text" }}
            rows={6}
          />
          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>
    </div>
  );
});
