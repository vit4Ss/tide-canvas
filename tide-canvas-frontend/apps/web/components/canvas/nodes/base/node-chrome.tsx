"use client";

import type { CSSProperties, ReactNode } from "react";

export type ChromePlacement = "top-left" | "top-right" | "top-center" | "bottom-center" | "left" | "right";

interface Props {
  /** 当前画布缩放 k；组件按 1/k 反向缩放，使自身在屏幕上保持恒定尺寸 */
  zoom: number;
  /** 相对卡片的吸附位置 */
  placement: ChromePlacement;
  /** 与卡片边缘的固定间隙（屏幕像素） */
  gap?: number;
  zIndex?: number;
  /** 缩放阻尼（0~1）：1=恒定屏幕尺寸；<1 时放大画布会让覆盖层也适当放大 */
  damp?: number;
  children: ReactNode;
}

/**
 * 外置组件「恒定大小·跟随节点」容器。
 * <p>
 * 用法：作为卡片定位容器（position: relative，尺寸等于卡片）的子元素放置。
 * 外层 anchor 贴在卡片某条边/角上，内层以贴边的那条边/角为 transform-origin
 * 做 scale(1/zoom) 反向缩放——抵消世界层的 scale(zoom)，于是子元素在任意缩放下
 * 都保持恒定屏幕尺寸，且吸附点始终钉在卡片边缘，随节点一起移动。
 * gap 作为内层 padding（处于反缩放空间内，故为恒定屏幕像素）。
 */
export function NodeChrome({ zoom, placement, gap = 8, zIndex = 10, damp = 1, children }: Props) {
  const z = zoom || 1;
  // damp<1：放大（z>1）时减弱反缩放，让覆盖层随之适当放大；缩小 / 正常仍保持恒定屏幕尺寸
  const inv = z > 1 ? 1 / Math.pow(z, damp) : 1 / z;
  const outer: CSSProperties = { position: "absolute", display: "flex", pointerEvents: "none", zIndex };
  const inner: CSSProperties = { transform: `scale(${inv})`, pointerEvents: "auto" };

  switch (placement) {
    case "bottom-center":
      Object.assign(outer, { top: "100%", left: 0, right: 0, justifyContent: "center", alignItems: "flex-start" });
      Object.assign(inner, { transformOrigin: "top center", paddingTop: gap });
      break;
    case "top-center":
      Object.assign(outer, { bottom: "100%", left: 0, right: 0, justifyContent: "center", alignItems: "flex-end" });
      Object.assign(inner, { transformOrigin: "bottom center", paddingBottom: gap });
      break;
    case "top-left":
      Object.assign(outer, { bottom: "100%", left: 0, right: 0, justifyContent: "flex-start", alignItems: "flex-end" });
      Object.assign(inner, { transformOrigin: "bottom left", paddingBottom: gap });
      break;
    case "top-right":
      Object.assign(outer, { bottom: "100%", left: 0, right: 0, justifyContent: "flex-end", alignItems: "flex-end" });
      Object.assign(inner, { transformOrigin: "bottom right", paddingBottom: gap });
      break;
    case "left":
      Object.assign(outer, { top: 0, bottom: 0, right: "100%", alignItems: "center", justifyContent: "flex-end" });
      Object.assign(inner, { transformOrigin: "center right", paddingRight: gap });
      break;
    case "right":
      Object.assign(outer, { top: 0, bottom: 0, left: "100%", alignItems: "center", justifyContent: "flex-start" });
      Object.assign(inner, { transformOrigin: "center left", paddingLeft: gap });
      break;
  }

  return (
    <div style={outer}>
      <div style={inner}>{children}</div>
    </div>
  );
}
