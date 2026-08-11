"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import type { CanvasFlowEdge } from "../../infrastructure/react-flow/canvas-flow-types";
import styles from "./canvas-flow.module.css";

function bezierPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  const distance = Math.hypot(targetX - sourceX, targetY - sourceY);
  const offset = Math.max(
    Math.abs(targetX - sourceX) * 0.5,
    Math.min(distance * 0.3, 160),
    50,
  );
  return `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY}, ${targetX - offset} ${targetY}, ${targetX} ${targetY}`;
}

export const CanvasFlowEdgeView = memo(function CanvasFlowEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  data,
  interactionWidth,
}: EdgeProps<CanvasFlowEdge>) {
  const visibleSourceX = data?.sourceAnchor?.x ?? sourceX;
  const visibleSourceY = data?.sourceAnchor?.y ?? sourceY;
  const visibleTargetX = data?.targetAnchor?.x ?? targetX;
  const visibleTargetY = data?.targetAnchor?.y ?? targetY;
  const path = bezierPath(visibleSourceX, visibleSourceY, visibleTargetX, visibleTargetY);
  const related = data?.relatedToSelection === true;
  const highlighted = selected || related;

  return (
    <>
      <BaseEdge
        path={path}
        interactionWidth={interactionWidth}
        className={highlighted
          ? "stroke-sky-500/80 dark:stroke-sky-400/80"
          : "stroke-neutral-300 dark:stroke-neutral-600"}
        style={{
          fill: "none",
          strokeWidth: highlighted ? 1.75 : 1.5,
          strokeLinecap: "round",
          transition: "stroke 160ms ease-out, stroke-width 160ms ease-out",
          vectorEffect: "non-scaling-stroke",
        }}
      />
      {related && (
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="3 10"
          vectorEffect="non-scaling-stroke"
          className={`${styles.edgeFlow} pointer-events-none text-sky-500/95 dark:text-sky-300/90`}
        />
      )}
    </>
  );
});
