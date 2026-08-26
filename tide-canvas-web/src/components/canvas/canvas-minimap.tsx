"use client";

import { useCallback, useMemo, useRef } from "react";
import type { CanvasNode } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { nodeRenderRect } from "@/lib/canvas-helpers";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";

interface Props {
  nodes: CanvasNode[];
  viewportSize: { width: number; height: number };
  onNavigate: (worldX: number, worldY: number) => void;
}

const MINI_WIDTH = 200;
const MINI_HEIGHT = 140;
const PADDING = 10;

// 各节点类型在小地图上的颜色（明暗两色皆可读）
const NODE_COLORS: Record<string, string> = {
  [CHARACTER_NODE_TYPE]: "#60a5fa",
  [SCENE_NODE_TYPE]: "#2dd4bf",
  text: "#22d3ee",
  image: "#34d399",
  video: "#fb923c",
  video_compose: "#f472b6",
  "3d": "#38bdf8",
  scene_3d: "#a78bfa",
  audio: "#c084fc",
  script: "#94a3b8",
};

export function CanvasMinimap({ nodes, viewportSize, onNavigate }: Props) {
  // 自行订阅视口：平移/缩放时可视区域矩形需要跟随，但不经由 CanvasView 传导
  const transform = useCanvasViewStore((s) => s.transform);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  // 世界坐标包围盒：包含所有节点 + 当前可视区域
  const bounds = useMemo(() => {
    const vw = viewportSize.width || 1;
    const vh = viewportSize.height || 1;
    const k = transform.k || 1; // 防 k 为 0/NaN 导致 Infinity 坐标
    const viewMinX = -transform.x / k;
    const viewMinY = -transform.y / k;
    const viewMaxX = viewMinX + vw / k;
    const viewMaxY = viewMinY + vh / k;

    let minX = viewMinX, minY = viewMinY, maxX = viewMaxX, maxY = viewMaxY;
    nodes.forEach((n) => {
      // 实际渲染矩形:名义 height 会让 9:21 竖图在小地图上只画出不到一半
      const r = nodeRenderRect(n);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
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

  // 拖动会话用冻结的映射:每次 onNavigate 改 transform → bounds 重算 →
  // 同一鼠标位置映射到新的世界点,视口矩形会追着光标橡皮筋式漂移抖动
  const dragBoundsRef = useRef<typeof bounds | null>(null);
  const navigateFromEvent = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const b = dragBoundsRef.current ?? bounds;
      const mx = ((e.clientX - rect.left) / rect.width) * MINI_WIDTH;
      const my = ((e.clientY - rect.top) / rect.height) * MINI_HEIGHT;
      const wx = b.minX + (mx - b.offsetX) / b.scale;
      const wy = b.minY + (my - b.offsetY) / b.scale;
      onNavigate(wx, wy);
    },
    [bounds, onNavigate]
  );

  // 可视区域矩形（小地图坐标）
  const vw = viewportSize.width || 1;
  const vh = viewportSize.height || 1;
  const k = transform.k || 1; // 防 k 为 0/NaN
  const vp = worldToMini(-transform.x / k, -transform.y / k);
  const vpW = (vw / k) * bounds.scale;
  const vpH = (vh / k) * bounds.scale;

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
        onMouseDown={(e) => { e.stopPropagation(); draggingRef.current = true; dragBoundsRef.current = bounds; navigateFromEvent(e); }}
        onMouseMove={(e) => { if (draggingRef.current) navigateFromEvent(e); }}
        onMouseUp={() => { draggingRef.current = false; dragBoundsRef.current = null; }}
        onMouseLeave={() => { draggingRef.current = false; dragBoundsRef.current = null; }}
      >
        {nodes.map((n) => {
          const r = nodeRenderRect(n);
          const tl = worldToMini(r.x, r.y);
          return (
            <rect
              key={n.id}
              x={tl.x}
              y={tl.y}
              width={Math.max(2, r.w * bounds.scale)}
              height={Math.max(2, r.h * bounds.scale)}
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
