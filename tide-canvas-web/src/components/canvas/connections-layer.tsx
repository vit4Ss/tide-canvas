"use client";

import { memo } from "react";
import type { CanvasNode, Connection } from "@/stores/use-canvas-store";

interface TempConnection {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
}

interface Props {
  nodes: CanvasNode[];
  connections: Connection[];
  temp?: TempConnection | null;
  selectedConnectionId?: string | null;
  onConnectionClick?: (id: string) => void;
}

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 50);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

export const ConnectionsLayer = memo(function ConnectionsLayer({ nodes, connections, temp, selectedConnectionId, onConnectionClick }: Props) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg className="absolute inset-0" style={{ overflow: "visible", pointerEvents: "none" }}>
      {connections.map((conn) => {
        const source = nodeMap.get(conn.sourceId);
        const target = nodeMap.get(conn.targetId);
        if (!source || !target) return null;
        const sx = source.x + source.width;
        const sy = source.y + source.height / 2;
        const tx = target.x;
        const ty = target.y + target.height / 2;
        const path = bezierPath(sx, sy, tx, ty);
        const isSelected = selectedConnectionId === conn.id;
        return (
          <g key={conn.id} style={{ pointerEvents: "auto", cursor: "pointer" }}>
            {/* 加粗透明命中区，方便点击 */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              onMouseDown={(e) => { e.stopPropagation(); onConnectionClick?.(conn.id); }}
            />
            {/* 可见线 */}
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={isSelected ? 3 : 2}
              className={isSelected ? "text-blue-500" : "text-neutral-400 dark:text-neutral-500"}
              pointerEvents="none"
            />
          </g>
        );
      })}

      {temp && (
        <path
          d={bezierPath(temp.startWorldX, temp.startWorldY, temp.currentWorldX, temp.currentWorldY)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray="6 4"
          className="text-blue-500"
          pointerEvents="none"
        />
      )}
    </svg>
  );
});
