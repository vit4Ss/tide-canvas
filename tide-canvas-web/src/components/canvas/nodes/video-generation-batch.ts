import type { CanvasNode, Connection } from "@/stores/use-canvas-store";

type VideoGenerationConfig = NonNullable<CanvasNode["generationConfig"]>;

export interface VideoGenerationBatchPlan {
  targetIds: string[];
  newNodes: CanvasNode[];
  newConnections: Connection[];
}

function positiveSize(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function renderRect(node: CanvasNode) {
  const width = positiveSize(node.width, 608);
  const height = positiveSize(node.height, 342);
  const w = positiveSize(node.contentW, width);
  const h = positiveSize(node.contentH, height);
  return { x: node.x + (width - w) / 2, y: node.y, w, h };
}

/** Plan independent video outputs without carrying a result or a request lifecycle into new nodes.
 * The caller commits this graph once, persists config on any reused original, then submits each target. */
export function planVideoGenerationBatch(
  node: CanvasNode,
  allNodes: readonly CanvasNode[],
  incomingConnections: readonly Connection[],
  count: 1 | 2 | 4,
  configOverrides: Partial<VideoGenerationConfig>,
  idFactory: () => string,
): VideoGenerationBatchPlan {
  if (node.type !== "video") throw new TypeError("Video batches require a video node");
  if (![1, 2, 4].includes(count)) throw new RangeError("Video batch count must be 1, 2 or 4");

  const canReuse = !node.videoSrc?.trim()
    && (node.status == null || node.status === "idle")
    && !node.pendingGeneration && !node.uploading && !node.taskId;
  const targetIds = canReuse ? [node.id] : [];
  const newNodes: CanvasNode[] = [];
  const newConnections: Connection[] = [];
  const usedIds = new Set([...allNodes.map((item) => item.id), node.id, ...incomingConnections.map((edge) => edge.id)]);
  const uniqueId = (seed: string) => {
    if (typeof seed !== "string" || !seed.trim()) throw new TypeError("The ID factory must return a non-empty ID");
    let id = seed;
    let suffix = 2;
    while (usedIds.has(id)) id = `${seed}_${suffix++}`;
    usedIds.add(id);
    return id;
  };

  const config: VideoGenerationConfig = { ...node.generationConfig, ...configOverrides, batchCount: 1 };
  delete config.threeDMode;
  delete config.enablePbr;
  delete config.faceCount;
  delete config.generateType;
  delete config.resultFormat;
  delete config.isPano;
  delete config.isPanoFor;

  const width = positiveSize(node.width, 608);
  const height = positiveSize(node.height, 342);
  const sourceRect = renderRect(node);
  const contentW = sourceRect.w;
  const contentH = sourceRect.h;
  const columnLeft = sourceRect.x + sourceRect.w + 80;
  const columnRight = columnLeft + contentW;
  const obstacles = allNodes.map(renderRect)
    .filter((rect) => rect.x < columnRight + 24 && rect.x + rect.w + 24 > columnLeft)
    .sort((a, b) => a.y - b.y);
  let nextY = node.y;

  for (let index = targetIds.length; index < count; index += 1) {
    // Use the first free vertical interval in the right column, including actual centered card bounds.
    for (const obstacle of obstacles) {
      if (nextY + contentH + 24 > obstacle.y && nextY < obstacle.y + obstacle.h + 24) {
        nextY = obstacle.y + obstacle.h + 24;
      }
    }
    const id = uniqueId(idFactory());
    const clone: CanvasNode = {
      id,
      type: "video",
      x: columnLeft - (width - contentW) / 2,
      y: nextY,
      width,
      height,
      contentW,
      contentH,
      title: `${node.title || "视频节点"} · ${index + 1}`,
      prompt: node.prompt,
      aspectRatio: config.aspectRatio ?? node.aspectRatio,
      generationConfig: { ...config },
      status: "idle",
      ...(node.videoOperation === "clip_reshoot" ? {
        videoOperation: node.videoOperation,
        clipReshootSourceId: node.clipReshootSourceId,
        clipReshootRanges: node.clipReshootRanges?.map(({ start, end }) => ({ start, end })),
      } : {}),
    };
    newNodes.push(clone);
    targetIds.push(id);
    nextY += contentH + 24;
  }

  const existingNodeIds = new Set(allNodes.map((item) => item.id));
  const seenPairs = new Set<string>();
  const sources = incomingConnections.filter((edge) => {
    if (edge.targetId !== node.id || edge.sourceId === node.id || !existingNodeIds.has(edge.sourceId)) return false;
    const pair = `${edge.sourceId}\u0000${edge.targetSlot ?? ""}`;
    if (seenPairs.has(pair)) return false;
    seenPairs.add(pair);
    return true;
  });
  for (const clone of newNodes) {
    sources.forEach((edge, index) => {
      newConnections.push({
        id: uniqueId(`video_batch_${clone.id}_${index + 1}`),
        sourceId: edge.sourceId,
        targetId: clone.id,
        ...(edge.targetSlot ? { targetSlot: edge.targetSlot } : {}),
        ...(edge.sourceOutput ? { sourceOutput: edge.sourceOutput } : {}),
      });
    });
  }
  return { targetIds, newNodes, newConnections };
}
