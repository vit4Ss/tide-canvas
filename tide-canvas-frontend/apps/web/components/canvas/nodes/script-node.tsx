"use client";

import { memo } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Clapperboard } from "lucide-react";
import { NodeHeader } from "./base/node-header";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
}

export const ScriptNode = memo(function ScriptNode({ node, isSelected, isDragging = false, isConnectTarget = false }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const showAuxUI = isSelected && !isDragging;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-node-id={node.id}
      className={`relative select-none ${isSelected ? "z-10" : ""}`}
      style={{ width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
    >
      <NodeHeader icon={Clapperboard} title={node.title || "脚本节点"} visible={showAuxUI} />

      <div className="relative">
        <div
          data-node-selected={isSelected && !isConnectTarget ? "true" : undefined}
          data-node-native-border="true"
          className={`canvas-node-selection-surface relative rounded-2xl border bg-white p-4 transition-all dark:bg-neutral-900 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            "border-neutral-200 dark:border-neutral-800"
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
        </div>
      </div>
    </div>
  );
});
