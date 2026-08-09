import type {
  CanvasGroup,
  CanvasHistorySnapshot,
  CanvasNode,
  CanvasSkillRunPersistence,
  Connection,
} from "../../domain/models/canvas-document";

export const MAX_CANVAS_HISTORY = 50;
export const MAX_TRACKED_SKILL_RUNS = 50;
export const GROUP_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
] as const;

let nodeCounter = 0;
let groupCounter = 0;

export function uniqueNonEmptyStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  ))];
}

export function restoredSkillRunState(
  nodes: readonly CanvasNode[],
  persisted?: CanvasSkillRunPersistence,
): Required<CanvasSkillRunPersistence> {
  const persistedRunIds = Array.isArray(persisted?.trackedRunIds) ? persisted.trackedRunIds : [];
  const persistedArtifactIds = Array.isArray(persisted?.materializedArtifactIds)
    ? persisted.materializedArtifactIds
    : [];
  return {
    trackedRunIds: uniqueNonEmptyStrings([
      ...persistedRunIds,
      ...nodes.map((node) => node.skillRunId),
      ...nodes.map((node) => node.provenance?.skillRunId),
    ]).slice(-MAX_TRACKED_SKILL_RUNS),
    materializedArtifactIds: uniqueNonEmptyStrings([
      ...persistedArtifactIds,
      ...nodes.map((node) => node.provenance?.artifactId),
    ]),
  };
}

function normalizePromptText(value: string): string {
  if (!value.includes("\\u")) return value;
  let decoded = value;
  for (let index = 0; index < 4; index += 1) {
    const next = decoded.replace(
      /\\+u([0-9a-fA-F]{4})/g,
      (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function normalizeCanvasNode(node: CanvasNode): CanvasNode {
  return typeof node.prompt === "string"
    ? { ...node, prompt: normalizePromptText(node.prompt) }
    : node;
}

export function normalizeCanvasNodePatch(data: Partial<CanvasNode>): Partial<CanvasNode> {
  return typeof data.prompt === "string"
    ? { ...data, prompt: normalizePromptText(data.prompt) }
    : data;
}

export function generateNodeId(): string {
  nodeCounter += 1;
  return `node_${Date.now()}_${nodeCounter}`;
}

export function generateGroupId(): string {
  groupCounter += 1;
  return `group_${Date.now()}_${groupCounter}`;
}

export function pruneGroups(groups: CanvasGroup[], removed: ReadonlySet<string>): CanvasGroup[] {
  if (removed.size === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => !removed.has(id)),
    }))
    .filter((group) => group.nodeIds.length > 0);
}

/** 清洗无法跨刷新恢复的上传、生成和 SkillRun 瞬态字段。 */
export function reviveNode(node: CanvasNode, options?: { keepResumable?: boolean }): CanvasNode {
  const stuckGenerating = node.status === "generating";
  const clonedActiveSkillRun = !options?.keepResumable && Boolean(node.skillRunId);
  if (options?.keepResumable && stuckGenerating && (node.taskId || node.pendingGeneration)) {
    return node.uploading ? { ...node, uploading: false, uploadProgress: undefined } : node;
  }
  if (
    !stuckGenerating
    && !node.uploading
    && !node.taskId
    && !node.pendingGeneration
    && !clonedActiveSkillRun
  ) return node;

  const hasResult = Boolean(
    node.imageSrc || node.videoSrc || node.audioSrc || node.content,
  );
  return {
    ...node,
    status: stuckGenerating ? (hasResult ? "success" : "idle") : node.status,
    taskId: undefined,
    pendingGeneration: undefined,
    skillRunId: clonedActiveSkillRun ? undefined : node.skillRunId,
    uploading: false,
    uploadProgress: undefined,
  };
}

export function canvasHistorySnapshot(state: {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
}): CanvasHistorySnapshot {
  return {
    nodes: state.nodes.map((node) => ({ ...node })),
    connections: state.connections.map((connection) => ({ ...connection })),
    groups: state.groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] })),
  };
}

export function hasRecoverableGeneration(node: CanvasNode): boolean {
  return node.status === "generating" && Boolean(node.taskId || node.pendingGeneration);
}

function keepGenerationState(historical: CanvasNode, current: CanvasNode): CanvasNode {
  return normalizeCanvasNode({
    ...historical,
    status: current.status,
    taskId: current.taskId,
    pendingGeneration: current.pendingGeneration,
    imageSrc: current.imageSrc,
    images: current.images,
    videoSrc: current.videoSrc,
    audioSrc: current.audioSrc,
    audioTracks: current.audioTracks,
    content: current.content,
    fileSize: current.fileSize,
    fileType: current.fileType,
    mimeType: current.mimeType,
    aspectRatio: current.aspectRatio,
    height: current.height,
    contentW: current.contentW,
    contentH: current.contentH,
    is360: current.is360,
  });
}

/** 历史仅恢复可编辑快照，实时生成回执始终以当前节点为准。 */
export function restoreHistoryNodes(
  currentNodes: CanvasNode[],
  historicalNodes: CanvasNode[],
): CanvasNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const restoredIds = new Set(historicalNodes.map((node) => node.id));
  const restored = historicalNodes.map((historical) => {
    const current = currentById.get(historical.id);
    if (current && hasRecoverableGeneration(current)) {
      return keepGenerationState(historical, current);
    }
    if (
      current
      && (historical.status === "generating" || historical.taskId || historical.pendingGeneration)
    ) {
      return keepGenerationState(historical, current);
    }
    return reviveNode(historical);
  });

  currentNodes.forEach((current) => {
    if (hasRecoverableGeneration(current) && !restoredIds.has(current.id)) restored.push(current);
  });
  return restored;
}
