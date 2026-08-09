import type {
  CanvasDocumentSnapshot,
  CanvasNode,
} from "../../domain/models/canvas-document";

export interface SerializeCanvasDocumentOptions {
  document: CanvasDocumentSnapshot;
  extensions?: Readonly<Record<string, unknown>>;
  sanitizeNode?: (node: CanvasNode) => CanvasNode;
}

/**
 * 框架无关的持久化出口。extensions 在前、标准字段在后，确保未知历史字段可以
 * 往返保留，但不能覆盖当前版本的 nodes/connections/groups/skillRuns。
 */
export function serializeCanvasDocument({
  document,
  extensions = {},
  sanitizeNode = (node) => node,
}: SerializeCanvasDocumentOptions): string {
  return JSON.stringify({
    ...extensions,
    nodes: document.nodes.map(sanitizeNode),
    connections: document.connections,
    groups: document.groups,
    skillRuns: document.skillRuns ?? {},
  });
}
