"use client";

import { NodeToolbar, Position, type Align } from "@xyflow/react";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";

export type ChromePlacement = "top-left" | "top-right" | "top-center" | "bottom-center" | "left" | "right";

interface Props {
  /** 兼容旧调用；React Flow 的 NodeToolbar 已负责抵消画布缩放 */
  zoom: number;
  /** 相对卡片的吸附位置 */
  placement: ChromePlacement;
  /** 与卡片边缘的固定间隙 */
  gap?: number;
  zIndex?: number;
  /** 兼容旧调用；React Flow 的 NodeToolbar 保持屏幕尺寸 */
  damp?: number;
  children: ReactNode;
}

const PLACEMENTS: Record<ChromePlacement, { position: Position; align: Align }> = {
  "top-left": { position: Position.Top, align: "start" },
  "top-right": { position: Position.Top, align: "end" },
  "top-center": { position: Position.Top, align: "center" },
  "bottom-center": { position: Position.Bottom, align: "center" },
  left: { position: Position.Left, align: "center" },
  right: { position: Position.Right, align: "center" },
};

/** 节点外部浮动层统一交给 React Flow 计算位置和反缩放。 */
export function NodeChrome({ placement, gap = 8, zIndex = 10, children }: Props) {
  const { position, align } = PLACEMENTS[placement];
  const style: CSSProperties = { zIndex, pointerEvents: "auto" };
  const stopCanvasInteraction = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <NodeToolbar
      isVisible
      position={position}
      align={align}
      offset={gap}
      style={style}
      className="nodrag nopan nowheel"
      onPointerDown={stopCanvasInteraction}
      onMouseDown={stopCanvasInteraction}
      onClick={stopCanvasInteraction}
      onDoubleClick={stopCanvasInteraction}
      onWheel={stopCanvasInteraction}
    >
      {children}
    </NodeToolbar>
  );
}
