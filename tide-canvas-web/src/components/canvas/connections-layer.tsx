"use client";

import { memo } from "react";
import type { CanvasNode, Connection } from "@/stores/use-canvas-store";
import {
  canvasConnectionGeometry,
  canvasConnectionLayerBounds,
} from "@/lib/canvas-connection-geometry";

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
  // 控制点偏移：水平间距的一半（水平长线保持接近直线），但垂直落差大、水平间距小时
  // 只按水平算会让中段近乎竖直、两端急弯——用直线距离兜底抬高偏移；上限压到 160，
  // 否则「横向很近、纵向很远」的连线（如源节点右侧竖排的多个结果）会甩出向左的大回环。
  return canvasConnectionGeometry(sx, sy, tx, ty).path;
}

export const ConnectionsLayer = memo(function ConnectionsLayer({ nodes, connections, temp, selectedConnectionId, selectedNodeIds, onConnectionClick }: Props) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const renderedConnections = connections.flatMap((connection) => {
    const source = nodeMap.get(connection.sourceId);
    const target = nodeMap.get(connection.targetId);
    if (!source || !target) return [];
    const sourceWidth = source.contentW ?? source.width;
    const sourceHeight = source.contentH ?? source.height;
    const targetWidth = target.contentW ?? target.width;
    const targetHeight = target.contentH ?? target.height;
    const geometry = canvasConnectionGeometry(
      source.x + (source.width + sourceWidth) / 2,
      source.y + sourceHeight / 2,
      target.x + (target.width - targetWidth) / 2,
      target.y + targetHeight / 2,
    );
    return [{ connection, geometry }];
  });
  const tempGeometry = temp
    ? canvasConnectionGeometry(temp.startWorldX, temp.startWorldY, temp.currentWorldX, temp.currentWorldY)
    : null;
  const layerBounds = canvasConnectionLayerBounds([
    ...renderedConnections.map(({ geometry }) => geometry),
    ...(tempGeometry ? [tempGeometry] : []),
  ]);

  if (!layerBounds) return null;

  return (
    <svg
      className="absolute"
      width={layerBounds.width}
      height={layerBounds.height}
      viewBox={layerBounds.viewBox}
      style={{
        left: layerBounds.left,
        top: layerBounds.top,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {renderedConnections.map(({ connection: conn, geometry }) => {
        const path = geometry.path;
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
