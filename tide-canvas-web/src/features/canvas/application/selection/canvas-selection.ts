import { nodeRenderRect } from "@/lib/canvas-helpers";
import type { CanvasNode } from "../../domain/models/canvas-document";

export interface CanvasSelectionAnchor {
  centerX: number;
  top: number;
}

/** 返回多选可见矩形的顶部中点；单选和空选返回 null。 */
export function getCanvasSelectionAnchor(
  nodes: readonly CanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
): CanvasSelectionAnchor | null {
  if (selectedNodeIds.size < 2) return null;
  const selected = nodes.filter((node) => selectedNodeIds.has(node.id));
  if (selected.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  selected.forEach((node) => {
    const rect = nodeRenderRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
  });
  return { centerX: (minX + maxX) / 2, top: minY };
}
