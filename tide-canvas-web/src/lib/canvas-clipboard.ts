import type { CanvasNode, Connection } from "@/stores/use-canvas-store";

export interface CanvasNodeClipboardSnapshot {
  node: CanvasNode;
  incomingConnections: Connection[];
}

/** blob: 是本地临时地址,原节点上传完成后会 revoke,快照里留着必成死链 */
const isBlobUrl = (u?: string): boolean => !!u && u.startsWith("blob:");

/** 复制"上传中"的节点时剥掉 blob 媒体:克隆体拿不到上传完成的回写,
 *  与其粘出一个几秒后必然破图的节点,不如诚实粘出空内容节点。 */
function stripVolatileMedia(node: CanvasNode): CanvasNode {
  const dirty =
    isBlobUrl(node.imageSrc) || isBlobUrl(node.videoSrc) || isBlobUrl(node.audioSrc) ||
    isBlobUrl(node.modelSrc) || node.images?.some(isBlobUrl) ||
    node.audioTracks?.some((t) => isBlobUrl(t.url));
  if (!dirty) return node;
  const c = { ...node };
  if (isBlobUrl(c.imageSrc)) delete c.imageSrc;
  if (isBlobUrl(c.videoSrc)) delete c.videoSrc;
  if (isBlobUrl(c.audioSrc)) delete c.audioSrc;
  if (isBlobUrl(c.modelSrc)) delete c.modelSrc;
  if (c.images) {
    c.images = c.images.filter((u) => !isBlobUrl(u));
    if (c.images.length === 0) delete c.images;
  }
  if (c.audioTracks) {
    c.audioTracks = c.audioTracks.filter((t) => !isBlobUrl(t.url));
    if (c.audioTracks.length === 0) delete c.audioTracks;
  }
  return c;
}

export function captureCanvasNodeClipboard(
  node: CanvasNode,
  connections: readonly Connection[],
): CanvasNodeClipboardSnapshot {
  return {
    node: stripVolatileMedia({ ...node }),
    incomingConnections: connections
      .filter((connection) => connection.targetId === node.id)
      .map((connection) => ({ ...connection })),
  };
}

export function materializeCanvasNodeClipboard(input: {
  snapshot: CanvasNodeClipboardSnapshot;
  newNodeId: string;
  availableNodeIds: ReadonlySet<string>;
  worldX?: number;
  worldY?: number;
}): { node: CanvasNode; connections: Connection[] } {
  const { snapshot, newNodeId, availableNodeIds, worldX, worldY } = input;
  const pasteAtWorldPoint = Number.isFinite(worldX) && Number.isFinite(worldY);
  const node: CanvasNode = {
    ...snapshot.node,
    id: newNodeId,
    x: pasteAtWorldPoint ? worldX! - snapshot.node.width / 2 : snapshot.node.x + 30,
    y: pasteAtWorldPoint ? worldY! - snapshot.node.height / 2 : snapshot.node.y + 30,
  };
  const connections = snapshot.incomingConnections
    .filter((connection) => availableNodeIds.has(connection.sourceId))
    .map((connection, index) => ({
      ...connection,
      id: `conn_copy_${newNodeId}_${index}`,
      targetId: newNodeId,
    }));
  return { node, connections };
}
