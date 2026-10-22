import type { CanvasNode, Connection } from "@/stores/use-canvas-store";
import { canvasConnectionRule } from "./canvas-connection-rules";
import { CHARACTER_NODE_TYPE, isConceptCanvasNodeType, isImageReferenceNodeType } from "./canvas-node-types";

export type CanvasVideoReferenceKind = "image" | "video" | "audio" | "text";

export interface CanvasVideoReference {
  node: CanvasNode;
  kind: CanvasVideoReferenceKind;
  /** A character/scene prompt is context, not an uploaded reference image. */
  settingOnly: boolean;
}

export interface CanvasVideoReferenceOptions {
  allowedKinds?: readonly CanvasVideoReferenceKind[];
  characterOnly?: boolean;
}

/** Match the media/context that the video generator actually reads from an incoming node. */
export function canvasVideoReferenceKind(node: CanvasNode): CanvasVideoReferenceKind | undefined {
  if ([node.imageSrc, node.videoSrc, node.audioSrc].some((src) => src?.startsWith("blob:"))) return undefined;
  if (isImageReferenceNodeType(node.type) && node.imageSrc?.trim()) return "image";
  if (node.type === "video" && node.videoSrc?.trim()) return "video";
  if (node.type === "audio" && node.audioSrc?.trim()) return "audio";
  if (node.type === "text" && node.content?.trim()) return "text";
  if (isConceptCanvasNodeType(node.type) && node.prompt?.trim()) return "text";
  return undefined;
}

/** Available sources only. A caller must recheck this against the current store before connecting. */
export function canvasVideoReferences(
  nodes: readonly CanvasNode[],
  connections: readonly Connection[],
  targetId: string,
  { allowedKinds, characterOnly = false }: CanvasVideoReferenceOptions = {},
): CanvasVideoReference[] {
  const target = nodes.find((node) => node.id === targetId);
  if (!target) return [];
  const connected = new Set(connections.filter((edge) => edge.targetId === targetId).map((edge) => edge.sourceId));
  const outgoing = new Map<string, string[]>();
  for (const edge of connections) {
    const next = outgoing.get(edge.sourceId) ?? [];
    next.push(edge.targetId);
    outgoing.set(edge.sourceId, next);
  }
  const downstream = new Set([targetId]);
  const queue = [targetId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of outgoing.get(queue[index]) ?? []) {
      if (downstream.has(next)) continue;
      downstream.add(next);
      queue.push(next);
    }
  }
  const result: CanvasVideoReference[] = [];
  for (const node of nodes) {
    if (downstream.has(node.id) || connected.has(node.id)) continue;
    if (node.uploading || node.pendingGeneration || node.status === "generating") continue;
    if (characterOnly && node.type !== CHARACTER_NODE_TYPE) continue;
    if (!canvasConnectionRule(node, target).allowed) continue;
    const kind = canvasVideoReferenceKind(node);
    if (!kind) continue;
    const settingOnly = kind === "text" && isConceptCanvasNodeType(node.type);
    // A role's written setting does not consume an image slot, even in an image-only role picker.
    if (allowedKinds && !allowedKinds.includes(kind) && !(characterOnly && settingOnly)) continue;
    result.push({ node, kind, settingOnly });
  }
  return result;
}
