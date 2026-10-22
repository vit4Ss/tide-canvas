import type { CanvasNode, Connection } from "@/stores/use-canvas-store";
import { isImageReferenceNodeType, isVisualReferenceNodeType } from "./canvas-node-types";

/** A reference cannot point backwards into its own downstream graph. */
export function canvasImageReferences(nodes: CanvasNode[], connections: Connection[], targetId: string) {
  const downstream = new Set([targetId]);
  const queue = [targetId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const connection of connections) {
      if (connection.sourceId === queue[index] && !downstream.has(connection.targetId)) {
        downstream.add(connection.targetId);
        queue.push(connection.targetId);
      }
    }
  }
  return nodes.filter((node) => !downstream.has(node.id) && isImageReferenceNodeType(node.type) && !!node.imageSrc && !node.imageSrc.startsWith("blob:") && !node.uploading && !node.pendingGeneration && node.status !== "generating");
}

export function imageReferenceCount(nodes: CanvasNode[], connections: Connection[], targetId: string) {
  const sourceIds = new Set(connections.filter((connection) => connection.targetId === targetId).map((connection) => connection.sourceId));
  return nodes.filter((node) => (node.id === targetId || sourceIds.has(node.id)) && isVisualReferenceNodeType(node.type) && (node.imageSrc || node.videoSrc)).length;
}
