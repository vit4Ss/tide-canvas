"use client";

import { useCanvasViewStore } from "@/stores/use-canvas-view-store";

export function CanvasGridBackground() {
  // 自行订阅视口（而非由 CanvasView 传 prop）：平移/缩放时只有本组件与世界层重渲染
  const transform = useCanvasViewStore((s) => s.transform);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" data-canvas="true">
      <defs>
        <pattern
          id="canvas-grid"
          width={20 * transform.k}
          height={20 * transform.k}
          patternUnits="userSpaceOnUse"
          x={transform.x % (20 * transform.k)}
          y={transform.y % (20 * transform.k)}
        >
          <circle cx="1" cy="1" r="1" fill="currentColor" className="text-neutral-300 dark:text-neutral-700" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-grid)" />
    </svg>
  );
}
