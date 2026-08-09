"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import type { CanvasFlowEdge } from "../../infrastructure/react-flow/canvas-flow-types";

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
  const path = bezierPath(sourceX, sourceY, targetX, targetY);
  const related = data?.relatedToSelection === true;
  const highlighted = selected || related;

  return (
    <>
      <BaseEdge
        path={path}
        interactionWidth={interactionWidth}
        className={highlighted ? "stroke-blue-500" : "stroke-neutral-400 dark:stroke-neutral-500"}
        style={{ fill: "none", strokeWidth: highlighted ? 3 : 2 }}
      />
      {related && (
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="16 200"
          className="pointer-events-none text-sky-200 dark:text-sky-300"
        >
          <animate attributeName="stroke-dashoffset" from="216" to="0" dur="1.3s" repeatCount="indefinite" />
        </path>
      )}
    </>
  );
});
