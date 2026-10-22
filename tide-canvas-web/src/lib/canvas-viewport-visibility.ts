export interface CanvasVisibleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CanvasViewportTransform {
  x: number;
  y: number;
  k: number;
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

/** Rectangles use the same world-space bounds as the rendered canvas nodes. */
export function hasCanvasNodeInViewport(
  rects: readonly CanvasVisibleRect[],
  transform: CanvasViewportTransform,
  viewport: CanvasViewportSize,
): boolean {
  if (viewport.width <= 0 || viewport.height <= 0 || transform.k <= 0) return false;

  return rects.some((rect) => {
    if (rect.w <= 0 || rect.h <= 0) return false;
    const left = rect.x * transform.k + transform.x;
    const top = rect.y * transform.k + transform.y;
    const right = left + rect.w * transform.k;
    const bottom = top + rect.h * transform.k;
    // Merely touching an edge does not put any of the node inside the view.
    return left < viewport.width && right > 0 && top < viewport.height && bottom > 0;
  });
}
