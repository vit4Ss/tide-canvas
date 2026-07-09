"use client";

import { memo, useCallback } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Clapperboard } from "lucide-react";
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

export const ScriptNode = memo(function ScriptNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
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
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={Clapperboard} title={node.title || "脚本节点"} visible={showAuxUI} />

      <div className="relative">
        <div
          className={`relative rounded-2xl border bg-white p-4 transition-all dark:bg-neutral-900 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ minHeight: 200 }}
        >
          <textarea
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
            onMouseDown={stop}
            placeholder="在此撰写剧本 / 分镜脚本…"
            className="w-full resize-none border-0 bg-transparent text-sm leading-7 text-neutral-800 outline-none placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100"
            style={{ outline: "none", boxShadow: "none", minHeight: 170, cursor: "text" }}
            rows={8}
            spellCheck={false}
          />
          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>
    </div>
  );
});
