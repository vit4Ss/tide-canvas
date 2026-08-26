export interface CanvasConnectionGeometry {
  path: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanvasConnectionLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  viewBox: string;
}

/** Build the canvas connection curve together with its complete control-point bounds. */
export function canvasConnectionGeometry(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): CanvasConnectionGeometry {
  const distance = Math.hypot(tx - sx, ty - sy);
  const dx = Math.max(Math.abs(tx - sx) * 0.5, Math.min(distance * 0.3, 160), 50);
  const c1x = sx + dx;
  const c2x = tx - dx;
  return {
    path: `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`,
    // A Bezier curve stays inside the convex hull of its end/control points.
    minX: Math.min(sx, tx, c1x, c2x),
    minY: Math.min(sy, ty),
    maxX: Math.max(sx, tx, c1x, c2x),
    maxY: Math.max(sy, ty),
  };
}

/**
 * Give the root SVG a real viewport containing every curve. Relying on an
 * unsized SVG's implicit 300x150 viewport makes distant curve segments get
 * clipped by browser compositing even when CSS overflow is visible.
 */
export function canvasConnectionLayerBounds(
  geometries: readonly CanvasConnectionGeometry[],
  padding = 24,
): CanvasConnectionLayerBounds | null {
  if (geometries.length === 0) return null;

  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 24;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let validGeometryCount = 0;
  for (const geometry of geometries) {
    if (![geometry.minX, geometry.minY, geometry.maxX, geometry.maxY].every(Number.isFinite)) continue;
    validGeometryCount += 1;
    minX = Math.min(minX, geometry.minX);
    minY = Math.min(minY, geometry.minY);
    maxX = Math.max(maxX, geometry.maxX);
    maxY = Math.max(maxY, geometry.maxY);
  }
  if (validGeometryCount === 0) return null;
  const left = Math.floor(minX - safePadding);
  const top = Math.floor(minY - safePadding);
  const right = Math.ceil(maxX + safePadding);
  const bottom = Math.ceil(maxY + safePadding);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return {
    left,
    top,
    width,
    height,
    viewBox: `${left} ${top} ${width} ${height}`,
  };
}
