"use client";

import { memo, useCallback, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Layers, Box, Image as ImageIcon, ArrowUpRight } from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { Scene3DEditor } from "./scene-3d-editor";
import { CHARACTER_NODE_TYPE } from "@/lib/canvas-node-types";
import { canvasThreeDSceneAssetFromNode } from "@/lib/canvas-three-d";

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
  // 是否已有图片/全景图连入（导演台编辑器会将其用作环境背景球）
  const panoConnected = useCanvasStore((s) =>
    s.connections.some((c) => {
      if (c.targetId !== node.id) return false;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      return !!src?.imageSrc && !src.videoSrc && src.type !== CHARACTER_NODE_TYPE;
    })
  );
  const sceneConnected = useCanvasStore((s) =>
    s.connections.some((connection) => {
      if (connection.targetId !== node.id) return false;
      const source = s.nodes.find((candidate) => candidate.id === connection.sourceId);
      return source?.type === "3d" && !!canvasThreeDSceneAssetFromNode(source);
    }),
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
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={Layers} title={node.title || "导演台"} visible={showAuxUI} overlay />

      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-xl border bg-[var(--popover)] transition-colors ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-[var(--canvas-input-focus-border)]" : "border-[var(--border)]"
          }`}
          style={{ height: cardHeight }}
        >
          {node.imageSrc ? (
            <>
              {/* Canvas previews can be blob/data URLs and must remain unoptimized. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={node.imageSrc} alt="" draggable={false} className="h-full w-full object-contain" />
              {/* 选中时悬浮重开入口：继续摆姿/再截图 */}
              {showAuxUI && (
                <button
                  type="button"
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); setEditorOpen(true); }}
                  className="absolute bottom-3 left-1/2 z-[6] flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--popover)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--canvas-menu-hover)]"
                >
                  <Box className="h-3.5 w-3.5" /> 打开导演台<ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (
            /* 未编辑占位：静态卡片可整体拖动，仅中间小按钮可点开编辑器 */
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-[var(--muted-foreground)]">
              <Layers className="h-10 w-10 opacity-60" strokeWidth={1.5} />
              <p className="text-center text-sm leading-6">在 3D 空间中搭建场景并进行多视角截图</p>
              {panoConnected && (
                <span className="flex items-center gap-1.5 text-xs">
                  <ImageIcon className="h-3.5 w-3.5" /> 已连接全景背景
                </span>
              )}
              {sceneConnected && (
                <span className="flex items-center gap-1.5 text-xs">
                  <Box className="h-3.5 w-3.5" /> 已连接 3D 场景
                </span>
              )}
              <button
                type="button"
                onMouseDown={stop}
                onClick={(e) => { stop(e); setEditorOpen(true); }}
                className="mt-1 flex h-8 items-center gap-1.5 rounded-lg bg-[var(--canvas-menu-hover)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                打开导演台<ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        </div>

        {/* 端口必须与 overflow-hidden 卡片同级：端口锚在卡片外，放卡片内会被整体裁掉 */}
        <NodePorts nodeId={node.id} visible={showAuxUI} overlay onPortMouseDown={onPortMouseDown} />
      </div>

      {editorOpen && <Scene3DEditor node={node} onClose={() => setEditorOpen(false)} />}
    </div>
  );
});
