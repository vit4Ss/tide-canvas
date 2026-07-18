"use client";

import { memo } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import styles from "./styles/animated-canvas-edge.module.css";

export interface CanvasEdgeData extends Record<string, unknown> {
  /** 选中连线，或选中其任一直接关联节点时启用流光。 */
  active: boolean;
}

export type CanvasFlowEdge = Edge<CanvasEdgeData, "canvasFlow">;

/** LibTV 风格连线：静态基线 + 沿 source → target 循环移动的蓝色流光。 */
export const AnimatedCanvasEdge = memo(function AnimatedCanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  style,
  interactionWidth,
}: EdgeProps<CanvasFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const active = Boolean(data?.active || selected);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={interactionWidth ?? 24}
        className={`${styles.basePath} ${active ? styles.activeBasePath : ""}`}
        style={style}
      />
      {active && (
        <g className={styles.flowLayer} aria-hidden="true">
          <path d={edgePath} pathLength={100} className={styles.flowGlow} />
          <path d={edgePath} pathLength={100} className={styles.flowCore} />
        </g>
      )}
    </>
  );
});
