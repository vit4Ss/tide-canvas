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
  /** 当前选中的节点；与之相连的连线高亮并显示流光 */
  selectedNodeIds?: Set<string>;
  onConnectionClick?: (id: string) => void;
}

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 50);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

export const ConnectionsLayer = memo(function ConnectionsLayer({ nodes, connections, temp, selectedConnectionId, selectedNodeIds, onConnectionClick }: Props) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg className="absolute inset-0" style={{ overflow: "visible", pointerEvents: "none" }}>
      {connections.map((conn) => {
        const source = nodeMap.get(conn.sourceId);
        const target = nodeMap.get(conn.targetId);
        if (!source || !target) return null;
        // 端点锚定到「卡片」真实边缘中点：卡片按图片比例渲染为 contentW×contentH，
        // 在 node.width 容器内水平居中、垂直自 node.y 起。非图片节点回退用名义尺寸。
        const sCW = source.contentW ?? source.width;
        const sCH = source.contentH ?? source.height;
        const tCW = target.contentW ?? target.width;
        const tCH = target.contentH ?? target.height;
        const sx = source.x + (source.width + sCW) / 2; // 源卡片右边缘
        const sy = source.y + sCH / 2;                  // 源卡片垂直中心
        const tx = target.x + (target.width - tCW) / 2; // 目标卡片左边缘
        const ty = target.y + tCH / 2;                  // 目标卡片垂直中心
        const path = bezierPath(sx, sy, tx, ty);
        const isSelected = selectedConnectionId === conn.id;
        // 与选中节点相连（入边/出边）→ 高亮 + 流光
        const related = !!selectedNodeIds && (selectedNodeIds.has(conn.sourceId) || selectedNodeIds.has(conn.targetId));
        const highlight = isSelected || related;
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
            {/* 可见线（相关/选中时蓝色加粗） */}
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={highlight ? 3 : 2}
              className={highlight ? "text-blue-500" : "text-neutral-400 dark:text-neutral-500"}
              pointerEvents="none"
            />
            {/* 流光：选中节点的相关连线上，一段亮色沿路径从源流向目标 */}
            {related && (
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray="16 200"
                className="text-sky-200 dark:text-sky-300"
                pointerEvents="none"
              >
                <animate attributeName="stroke-dashoffset" from="216" to="0" dur="1.3s" repeatCount="indefinite" />
              </path>
            )}
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
