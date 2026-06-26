"use client";

import { useCallback, useMemo, useRef } from "react";
import type { CanvasNode } from "@/stores/use-canvas-store";

interface Props {
  nodes: CanvasNode[];
  transform: { x: number; y: number; k: number };
  viewportSize: { width: number; height: number };
  onNavigate: (worldX: number, worldY: number) => void;
}

const MINI_WIDTH = 200;
const MINI_HEIGHT = 140;
const PADDING = 10;

// 各节点类型在小地图上的颜色（明暗两色皆可读）
const NODE_COLORS: Record<string, string> = {
  text: "#22d3ee",
  image: "#34d399",
  video: "#fb923c",
  video_compose: "#f472b6",
  scene_3d: "#a78bfa",
  audio: "#c084fc",
  script: "#94a3b8",
};

export function CanvasMinimap({ nodes, transform, viewportSize, onNavigate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  // 世界坐标包围盒：包含所有节点 + 当前可视区域
  const bounds = useMemo(() => {
    const vw = viewportSize.width || 1;
    const vh = viewportSize.height || 1;
    const viewMinX = -transform.x / transform.k;
    const viewMinY = -transform.y / transform.k;
    const viewMaxX = viewMinX + vw / transform.k;
    const viewMaxY = viewMinY + vh / transform.k;

    let minX = viewMinX, minY = viewMinY, maxX = viewMaxX, maxY = viewMaxY;
    nodes.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    const pad = 200;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const drawW = MINI_WIDTH - PADDING * 2;
    const drawH = MINI_HEIGHT - PADDING * 2;
    const scale = Math.min(drawW / w, drawH / h);
    const offsetX = PADDING + (drawW - w * scale) / 2;
    const offsetY = PADDING + (drawH - h * scale) / 2;
    return { minX, minY, scale, offsetX, offsetY };
  }, [nodes, transform, viewportSize]);

  const worldToMini = useCallback(
    (wx: number, wy: number) => ({
      x: bounds.offsetX + (wx - bounds.minX) * bounds.scale,
      y: bounds.offsetY + (wy - bounds.minY) * bounds.scale,
    }),
    [bounds]
  );

  const navigateFromEvent = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = ((e.clientX - rect.left) / rect.width) * MINI_WIDTH;
      const my = ((e.clientY - rect.top) / rect.height) * MINI_HEIGHT;
      const wx = bounds.minX + (mx - bounds.offsetX) / bounds.scale;
      const wy = bounds.minY + (my - bounds.offsetY) / bounds.scale;
      onNavigate(wx, wy);
    },
    [bounds, onNavigate]
  );

  // 可视区域矩形（小地图坐标）
  const vw = viewportSize.width || 1;
  const vh = viewportSize.height || 1;
  const vp = worldToMini(-transform.x / transform.k, -transform.y / transform.k);
  const vpW = (vw / transform.k) * bounds.scale;
  const vpH = (vh / transform.k) * bounds.scale;

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95"
      style={{ width: MINI_WIDTH, height: MINI_HEIGHT }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MINI_WIDTH} ${MINI_HEIGHT}`}
        width={MINI_WIDTH}
        height={MINI_HEIGHT}
        className="block cursor-pointer"
        onMouseDown={(e) => { e.stopPropagation(); draggingRef.current = true; navigateFromEvent(e); }}
        onMouseMove={(e) => { if (draggingRef.current) navigateFromEvent(e); }}
        onMouseUp={() => { draggingRef.current = false; }}
        onMouseLeave={() => { draggingRef.current = false; }}
      >
        {nodes.map((n) => {
          const tl = worldToMini(n.x, n.y);
          return (
            <rect
              key={n.id}
              x={tl.x}
              y={tl.y}
              width={Math.max(2, n.width * bounds.scale)}
              height={Math.max(2, n.height * bounds.scale)}
              rx={1.5}
              fill={NODE_COLORS[n.type] || "#a1a1aa"}
              opacity={0.85}
            />
          );
        })}
        <rect
          x={vp.x}
          y={vp.y}
          width={vpW}
          height={vpH}
          fill="rgba(59,130,246,0.12)"
          stroke="#3b82f6"
          strokeWidth={1}
          rx={2}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
