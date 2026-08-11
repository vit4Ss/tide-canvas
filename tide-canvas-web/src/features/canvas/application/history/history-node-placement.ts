import { createNode, nodeRenderRect } from "@/lib/canvas-helpers";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import type { CanvasNode } from "@/stores/use-canvas-store";
import type { MediaAssetVO } from "@/types/media-asset";

interface CanvasPoint {
  x: number;
  y: number;
}

export interface HistoryNodePlacement {
  nodes: CanvasNode[];
  bounds: { x: number; y: number; width: number; height: number };
}

const SUPPORTED_NODE_TYPES = new Set([
  CHARACTER_NODE_TYPE,
  SCENE_NODE_TYPE,
  "image",
  "video",
  "audio",
]);
const NODE_GAP = 80;
const EXISTING_NODE_CLEARANCE = 64;

function nodeTypeOf(asset: MediaAssetVO): string {
  if (SUPPORTED_NODE_TYPES.has(asset.nodeType)) return asset.nodeType;
  return asset.mediaType;
}

function assetNode(asset: MediaAssetVO, existing: CanvasNode[]): CanvasNode {
  const type = nodeTypeOf(asset);
  const node = createNode(type, 0, 0, existing);
  node.title = asset.name || (asset.sourceType === "generation" ? "生成结果" : "上传资源");
  node.status = "success";
  node.mimeType = asset.mimeType || undefined;
  node.fileType = asset.mediaType === "audio" ? "other" : asset.mediaType;
  node.historyAssetId = asset.id;
  node.historySource = asset.sourceType;

  if (asset.mediaType === "video") {
    node.videoSrc = asset.url;
  } else if (asset.mediaType === "audio") {
    node.audioSrc = asset.url;
    node.audioTracks = [{ url: asset.url, title: asset.name }];
    if (asset.thumbnailUrl) node.coverUrl = asset.thumbnailUrl;
  } else {
    node.imageSrc = asset.url;
  }
  return node;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function candidateCenters(
  preferred: CanvasPoint,
  width: number,
  height: number,
): CanvasPoint[] {
  const candidates: CanvasPoint[] = [preferred];
  const stepX = width + NODE_GAP * 2;
  const stepY = height + NODE_GAP * 2;
  for (let ring = 1; ring <= 10; ring += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      candidates.push({ x: preferred.x + x * stepX, y: preferred.y - ring * stepY });
      candidates.push({ x: preferred.x + x * stepX, y: preferred.y + ring * stepY });
    }
    for (let y = -ring + 1; y < ring; y += 1) {
      candidates.push({ x: preferred.x - ring * stepX, y: preferred.y + y * stepY });
      candidates.push({ x: preferred.x + ring * stepX, y: preferred.y + y * stepY });
    }
  }
  return candidates;
}

/**
 * Materialize history assets as a compact grid in the nearest blank canvas
 * region. Existing nodes are treated as padded rectangles so restored media
 * never lands underneath a card or inside a connection-heavy cluster.
 */
export function placeHistoryAssets(
  assets: readonly MediaAssetVO[],
  existingNodes: readonly CanvasNode[],
  preferredCenter: CanvasPoint,
): HistoryNodePlacement {
  const draft: CanvasNode[] = [];
  for (const asset of assets) {
    draft.push(assetNode(asset, [...existingNodes, ...draft]));
  }
  if (draft.length === 0) {
    return { nodes: [], bounds: { x: preferredCenter.x, y: preferredCenter.y, width: 0, height: 0 } };
  }

  const columnCount = Math.max(1, Math.ceil(Math.sqrt(draft.length * 1.35)));
  const rowCount = Math.ceil(draft.length / columnCount);
  const cellWidth = Math.max(...draft.map((node) => node.width));
  const cellHeight = Math.max(...draft.map((node) => node.contentH ?? node.height));
  const width = columnCount * cellWidth + Math.max(0, columnCount - 1) * NODE_GAP;
  const height = rowCount * cellHeight + Math.max(0, rowCount - 1) * NODE_GAP;
  const occupied = existingNodes.map((node) => {
    const rect = nodeRenderRect(node);
    return {
      x: rect.x - EXISTING_NODE_CLEARANCE,
      y: rect.y - EXISTING_NODE_CLEARANCE,
      width: rect.w + EXISTING_NODE_CLEARANCE * 2,
      height: rect.h + EXISTING_NODE_CLEARANCE * 2,
    };
  });

  let center = preferredCenter;
  let foundBlankRegion = false;
  for (const candidate of candidateCenters(preferredCenter, width, height)) {
    const group = {
      x: candidate.x - width / 2,
      y: candidate.y - height / 2,
      width,
      height,
    };
    if (!occupied.some((rect) => overlaps(group, rect))) {
      center = candidate;
      foundBlankRegion = true;
      break;
    }
  }
  if (!foundBlankRegion && occupied.length > 0) {
    const rightEdge = Math.max(...occupied.map((rect) => rect.x + rect.width));
    center = { x: rightEdge + NODE_GAP + width / 2, y: preferredCenter.y };
  }

  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const nodes = draft.map((node, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    return {
      ...node,
      x: originX + column * (cellWidth + NODE_GAP) + (cellWidth - node.width) / 2,
      y: originY + row * (cellHeight + NODE_GAP),
    };
  });

  return { nodes, bounds: { x: originX, y: originY, width, height } };
}
