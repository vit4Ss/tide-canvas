import type { CanvasNode } from "@/stores/use-canvas-store";

interface WorldPoint {
  x: number;
  y: number;
}

interface CanvasNodeHitOptions {
  excludeNodeId?: string;
  marginScreenPixels?: number;
  zoom?: number;
}

/** Keep pointer hit tolerance visually constant while the canvas is zoomed. */
export function canvasHitMarginWorld(screenPixels: number, zoom: number): number {
  const safePixels = Number.isFinite(screenPixels) ? Math.max(0, screenPixels) : 0;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return safePixels / safeZoom;
}

/** Later canvas nodes render above earlier ones, so hit testing must walk backwards. */
export function findTopmostCanvasNodeAt(
  nodes: readonly CanvasNode[],
  point: WorldPoint,
  options: CanvasNodeHitOptions = {},
): CanvasNode | undefined {
  const margin = canvasHitMarginWorld(options.marginScreenPixels ?? 0, options.zoom ?? 1);
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.id === options.excludeNodeId) continue;
    const width = node.contentW ?? node.width;
    const height = node.contentH ?? node.height;
    const left = node.x + (node.width - width) / 2;
    if (
      point.x >= left - margin
      && point.x <= left + width + margin
      && point.y >= node.y - margin
      && point.y <= node.y + height + margin
    ) {
      return node;
    }
  }
  return undefined;
}

export function exceedsScreenDragThreshold(
  start: WorldPoint,
  end: WorldPoint,
  thresholdPixels: number,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > Math.max(0, thresholdPixels);
}
