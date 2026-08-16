import type { CanvasNode, Connection } from "@/stores/use-canvas-store";

export interface CanvasNodeClipboardSnapshot {
  node: CanvasNode;
  incomingConnections: Connection[];
}

export function captureCanvasNodeClipboard(
  node: CanvasNode,
  connections: readonly Connection[],
): CanvasNodeClipboardSnapshot {
  return {
    node: { ...node },
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
