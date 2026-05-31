"use client";

import { Plus, Minus, Map, Magnet, LayoutGrid, Undo2, Redo2, Frame } from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Props {
  zoom: number;
  gridSnap: boolean;
  minimapVisible: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitView: () => void;
  onToggleGridSnap: () => void;
  onToggleMinimap: () => void;
  onArrange: () => void;
}

export function CanvasBottomToolbar({
  zoom, gridSnap, minimapVisible,
  onZoomIn, onZoomOut, onZoomReset, onFitView,
  onToggleGridSnap, onToggleMinimap, onArrange,
}: Props) {
  const undoStackLen = useCanvasStore((s) => s.undoStack.length);
  const redoStackLen = useCanvasStore((s) => s.redoStack.length);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);

  const btn = "rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-300";
  const btnActive = "rounded-lg p-1.5 bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white";

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-neutral-200 bg-white p-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <button onClick={undo} disabled={undoStackLen === 0} title="撤销 (Ctrl+Z)" className={btn}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button onClick={redo} disabled={redoStackLen === 0} title="重做 (Ctrl+Y)" className={btn}>
        <Redo2 className="h-4 w-4" />
      </button>
      <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      <button onClick={onFitView} title="适应视图（缩放到全部节点）" className={btn}>
        <Frame className="h-4 w-4" />
      </button>
      <button onClick={onArrange} title="自动排列" className={btn}>
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button onClick={onToggleMinimap} title="小地图" className={minimapVisible ? btnActive : btn}>
        <Map className="h-4 w-4" />
      </button>
      <button onClick={onToggleGridSnap} title="网格吸附" className={gridSnap ? btnActive : btn}>
        <Magnet className="h-4 w-4" />
      </button>
      <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      <button onClick={onZoomOut} disabled={zoom <= 0.1} title="缩小" className={btn}>
        <Minus className="h-4 w-4" />
      </button>
      <button onClick={onZoomReset} title="重置缩放"
        className="min-w-[3rem] rounded-lg px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={onZoomIn} disabled={zoom >= 5} title="放大" className={btn}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
