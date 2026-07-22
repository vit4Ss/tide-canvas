"use client";

import { memo, useCallback, useState } from "react";
import { Box, Image as ImageIcon, Plus, X } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { ossDisplayUrl } from "@/lib/oss-display";
import { NodeChrome } from "./base/node-chrome";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

export const STYLE_REFERENCE_NODE_TYPE = "style_reference";

export const StyleReferenceNode = memo(function StyleReferenceNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
  onNodeMouseDown,
  onPortMouseDown,
}: Props) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const [hovered, setHovered] = useState(false);
  const [broken, setBroken] = useState(false);
  const coverUrl = node.stylePresetCoverUrl || node.imageSrc || "";
  const showControls = (isSelected || hovered || isConnectTarget) && !isDragging;

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => onNodeMouseDown(node.id, event),
    [node.id, onNodeMouseDown],
  );

  return (
    <div
      data-node-id={node.id}
      className="absolute select-none"
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="mb-2 flex h-5 min-w-0 items-center gap-1.5 text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
        <Box className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.title || "素材-风格"}</span>
      </div>

      <div
        className={`group relative overflow-hidden rounded-xl border bg-neutral-100 shadow-sm transition-all dark:bg-neutral-900 ${
          isConnectTarget
            ? "border-blue-500 ring-2 ring-blue-400/40"
            : isSelected
              ? "border-blue-500 shadow-lg ring-2 ring-blue-400/40"
              : "border-neutral-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800"
        }`}
        style={{ height: Math.max(180, node.height - 28) }}
      >
        {coverUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ossDisplayUrl(coverUrl, 1024)}
            alt={node.title}
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-100 via-neutral-50 to-white text-neutral-400 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-950">
            <ImageIcon className="h-10 w-10" />
            <span className="text-xs">风格素材</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/65 via-black/20 to-transparent p-3 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <span className="min-w-0 truncate text-xs font-medium">{node.stylePresetName || node.title}</span>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              removeNode(node.id);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/92 text-neutral-900 shadow-sm hover:bg-white"
            title="移除风格引用"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showControls && (
        <NodeChrome placement="right" gap={10}>
          <button
            type="button"
            onMouseDown={(event) => {
              event.stopPropagation();
              onPortMouseDown?.(node.id, "output", event.clientX, event.clientY);
            }}
            className="flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 shadow-sm transition hover:scale-110 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 active:scale-95 dark:border-neutral-700 dark:bg-neutral-900"
            title="拖到图片节点作为风格引用"
          >
            <Plus className="h-3 w-3" />
          </button>
        </NodeChrome>
      )}
    </div>
  );
});