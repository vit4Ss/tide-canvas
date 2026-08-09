"use client";

import { Group } from "lucide-react";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import type { CanvasSelectionAnchor } from "../../application/selection/canvas-selection";

interface CanvasGroupCreateButtonProps {
  anchor: CanvasSelectionAnchor;
  containerOrigin: { left: number; top: number };
  onClick: () => void;
}

/** 将世界坐标中的多选锚点映射为固定屏幕坐标。 */
export function CanvasGroupCreateButton({
  anchor,
  containerOrigin,
  onClick,
}: CanvasGroupCreateButtonProps) {
  const transform = useCanvasViewStore((state) => state.transform);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        left: containerOrigin.left + transform.x + anchor.centerX * transform.k,
        top: containerOrigin.top + transform.y + anchor.top * transform.k - 12,
      }}
      className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      <Group className="h-3.5 w-3.5" aria-hidden />
      创建分组
      <kbd className="ml-0.5 opacity-60">⌘G</kbd>
    </button>
  );
}
