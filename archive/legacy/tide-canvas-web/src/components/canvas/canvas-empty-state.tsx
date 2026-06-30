"use client";

export function CanvasEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="text-center text-neutral-400">
        <p className="text-sm">右键点击画布添加节点</p>
        <p className="mt-1 text-xs">滚轮缩放 · 拖拽平移</p>
      </div>
    </div>
  );
}
