"use client";

import { memo, useState } from "react";
import { Box, Image as ImageIcon, X } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
}

export const STYLE_REFERENCE_NODE_TYPE = "style_reference";

export const StyleReferenceNode = memo(function StyleReferenceNode({
  node,
  isSelected,
  isConnectTarget = false,
}: Props) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const [broken, setBroken] = useState(false);
  const coverUrl = node.stylePresetCoverUrl || node.imageSrc || "";

  return (
    <div
      data-node-id={node.id}
      className="relative select-none"
      style={{ width: node.width, minHeight: node.height }}
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

          <img
            src={coverUrl}
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
    </div>
  );
});
