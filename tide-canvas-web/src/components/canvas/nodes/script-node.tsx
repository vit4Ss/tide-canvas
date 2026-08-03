"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Clapperboard } from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { CanvasSkillRunNodeShortcut } from "../skill-run/canvas-skill-run-workspace";

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

  // 画布平移用原生冒泡 wheel 监听且 preventDefault,先于 React 合成 onWheel;
  // 必须挂原生 listener(同 prompt-ref-editor),否则长剧本滚不动、滚轮只平移画布。
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollHeight > el.clientHeight) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
          {/* 卡片几乎整脸都是 textarea：未选中时它不接管鼠标（点击/拖动 = 选中/拖动节点），
              选中后才进入编辑态，可划选复制；拖动已选中节点用标题栏或边框环。 */}
          <textarea
            ref={taRef}
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
            onMouseDown={isSelected ? stop : undefined}
            placeholder="在此撰写剧本 / 分镜脚本…"
            className="w-full select-text resize-none border-0 bg-transparent text-sm leading-7 text-neutral-800 outline-none placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0 dark:text-neutral-100"
            style={{
              outline: "none",
              boxShadow: "none",
              minHeight: 170,
              cursor: isSelected ? "text" : "inherit",
              pointerEvents: isSelected ? "auto" : "none",
            }}
            rows={8}
            spellCheck={false}
          />
          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
          <CanvasSkillRunNodeShortcut nodeId={node.id} nodeType={node.type} visible={showAuxUI} />
        </div>
      </div>
    </div>
  );
});
