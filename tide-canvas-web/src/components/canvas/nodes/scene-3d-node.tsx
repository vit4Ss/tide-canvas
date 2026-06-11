"use client";

import { memo, useCallback, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Layers, Box } from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { Scene3DEditor } from "./scene-3d-editor";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

/** 导演台节点：画布上只显示预览 + 「打开导演台」入口；真正的 3D 摆姿在全屏编辑器里。 */
export const Scene3DNode = memo(function Scene3DNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const zoom = useCanvasStore((s) => s.transform.k);
  // 是否已有图片/全景图连入（导演台编辑器会将其用作环境背景球）
  const panoConnected = useCanvasStore((s) =>
    s.connections.some((c) => {
      if (c.targetId !== node.id) return false;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      return !!src?.imageSrc && !src.videoSrc;
    })
  );
  const [editorOpen, setEditorOpen] = useState(false);

  const showAuxUI = isSelected && !isDragging;
  const cardHeight = Math.round(node.width / 2); // 2:1

  const handleMouseDown = useCallback((e: React.MouseEvent) => onNodeMouseDown(node.id, e), [node.id, onNodeMouseDown]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={Layers} title={node.title || "导演台"} visible={showAuxUI} zoom={zoom} />

      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-2xl border transition-all ${
            node.imageSrc ? "bg-gradient-to-br from-slate-800 to-slate-900" : "bg-white dark:bg-neutral-950"
          } ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ height: cardHeight }}
        >
          {node.imageSrc ? (
            <>
              <img src={node.imageSrc} alt="" draggable={false} className="h-full w-full object-contain" />
              {/* 选中时悬浮重开入口：继续摆姿/再截图 */}
              {showAuxUI && (
                <button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); setEditorOpen(true); }}
                  className="absolute bottom-3 left-1/2 z-[6] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/70"
                >
                  <Box className="h-3.5 w-3.5" /> 打开导演台
                </button>
              )}
            </>
          ) : (
            /* 未编辑占位：静态卡片可整体拖动，仅中间小按钮可点开编辑器 */
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
              <Layers className="h-10 w-10 text-neutral-300 dark:text-neutral-600" />
              <p className="text-sm text-neutral-500 dark:text-neutral-400">在 3D 空间中搭建场景并进行多视角截图</p>
              {panoConnected && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 已连接全景背景
                </span>
              )}
              <button
                onMouseDown={stop}
                onClick={(e) => { stop(e); setEditorOpen(true); }}
                className="mt-1 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                打开导演台
              </button>
            </div>
          )}

          <NodePorts nodeId={node.id} visible={showAuxUI} zoom={zoom} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>

      {editorOpen && <Scene3DEditor node={node} onClose={() => setEditorOpen(false)} />}
    </div>
  );
});
