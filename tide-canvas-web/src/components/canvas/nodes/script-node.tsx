"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
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

  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const syncContentSize = () => {
      // offset 尺寸不受画布缩放影响，连线与框选需使用脚本文档的实际边界。
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const current = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
      if (current && width > 0 && height > 0 && (current.contentW !== width || current.contentH !== height)) {
        updateNode(node.id, { contentW: width, contentH: height }, false);
      }
    };
    syncContentSize();
    const observer = new ResizeObserver(syncContentSize);
    observer.observe(card, { box: "border-box" });
    return () => observer.disconnect();
  }, [node.id, updateNode]);

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
      <NodeHeader icon={Clapperboard} title={node.title || "脚本节点"} visible={showAuxUI} overlay />

      <div className="relative">
        <div
          ref={cardRef}
          className={`relative rounded-xl border bg-[var(--popover)] p-4 transition-colors ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-[var(--canvas-input-focus-border)]" : "border-[var(--border)]"
          }`}
          style={{ minHeight: 200 }}
        >
          {/* 卡片几乎整脸都是 textarea：未选中时它不接管鼠标（点击/拖动 = 选中/拖动节点），
              选中后才进入编辑态，可划选复制；拖动已选中节点用标题栏或边框环。 */}
          <textarea
            ref={taRef}
            aria-label="脚本内容"
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
            onMouseDown={isSelected ? stop : undefined}
            placeholder="在此撰写剧本 / 分镜脚本…"
            className="w-full select-text resize-none border-0 bg-transparent text-sm leading-7 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:outline-none focus-visible:outline-none focus:ring-0"
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
          <div className="mt-2 flex justify-end text-xs tabular-nums text-[var(--muted-foreground)]">
            {Array.from(node.prompt || "").length} 字
          </div>
          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>
    </div>
  );
});
