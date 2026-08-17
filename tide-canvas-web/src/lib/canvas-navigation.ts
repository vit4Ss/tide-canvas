"use client";

export const CANVAS_FOCUS_POINT_EVENT = "tide-canvas-focus-point";

export interface CanvasFocusPoint {
  x: number;
  y: number;
}

/** Ask the mounted canvas viewport to reveal one world-space point. */
export function requestCanvasFocusPoint(point: CanvasFocusPoint): void {
  if (typeof window === "undefined" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  window.dispatchEvent(new CustomEvent<CanvasFocusPoint>(CANVAS_FOCUS_POINT_EVENT, { detail: point }));
}
