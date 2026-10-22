import type {
  CanvasGroup,
  CanvasNode,
  CanvasSkillRunPersistence,
  Connection,
} from "@/stores/use-canvas-store";

export interface CanvasDocument {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
  skillRuns?: CanvasSkillRunPersistence;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Validate the document envelope before handing individual rows to the store's
 * salvage layer. A JSON string/array or a wrongly typed graph field must not be
 * interpreted as an empty canvas and then autosaved over the remote original.
 */
export function parseCanvasDocument(raw: string): CanvasDocument {
  const parsed: unknown = JSON.parse(raw);
  const document = objectValue(parsed);
  if (!document) throw new Error("canvas document is not an object");

  const arrayField = (key: "nodes" | "connections" | "groups") => {
    const value = document[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`canvas ${key} is not an array`);
    return value;
  };

  const persistedRuns = document.skillRuns ?? document.skillRunState;
  if (persistedRuns !== undefined && !objectValue(persistedRuns)) {
    throw new Error("canvas skillRuns is not an object");
  }

  return {
    nodes: arrayField("nodes") as CanvasNode[],
    connections: arrayField("connections") as Connection[],
    groups: arrayField("groups") as CanvasGroup[],
    ...(persistedRuns === undefined
      ? {}
      : { skillRuns: persistedRuns as CanvasSkillRunPersistence }),
  };
}

export type CanvasViewMode = "workflow" | "storyboard";
export interface WorkspaceCanvas {
  id: string;
  name: string;
  document: CanvasDocument;
  viewport: { x: number; y: number; k: number };
  viewMode: CanvasViewMode;
}
export interface CanvasWorkspace {
  version: 1;
  activeCanvasId: string;
  canvases: WorkspaceCanvas[];
}

/** Local document identity; HTTP LAN origins do not expose crypto.randomUUID. */
export function createWorkspaceCanvasId(uuid: (() => string) | null = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? () => crypto.randomUUID() : null): string {
  return uuid ? uuid() : `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function initialCanvasWorkspace(document: CanvasDocument = { nodes: [], connections: [], groups: [] }): CanvasWorkspace {
  return { version: 1, activeCanvasId: "canvas-1", canvases: [{ id: "canvas-1", name: "画布 1", document, viewport: { x: 0, y: 0, k: 1 }, viewMode: "workflow" }] };
}

export function parseCanvasWorkspace(raw: string): CanvasWorkspace {
  const legacy = parseCanvasDocument(raw);
  const parsed = JSON.parse(raw);
  if (parsed.workspace === undefined) return initialCanvasWorkspace(legacy);
  const workspace = parsed.workspace;
  if (!workspace || workspace.version !== 1 || !Array.isArray(workspace.canvases) || !workspace.canvases.length) throw new Error("invalid canvas workspace");
  const ids = new Set<string>();
  const canvases = workspace.canvases.map((canvas: WorkspaceCanvas) => {
    if (!canvas || typeof canvas.id !== "string" || !canvas.id || ids.has(canvas.id) || typeof canvas.name !== "string" || !canvas.name.trim()) throw new Error("invalid workspace canvas");
    ids.add(canvas.id);
    if (!canvas.document || typeof canvas.document !== "object" || Array.isArray(canvas.document)) throw new Error("invalid canvas snapshot");
    const document = parseCanvasDocument(JSON.stringify(canvas.document));
    const viewport = canvas.viewport;
    if (!viewport || ![viewport.x, viewport.y, viewport.k].every(Number.isFinite) || viewport.k < 0.1 || viewport.k > 5) throw new Error("invalid canvas viewport");
    if (canvas.viewMode !== "workflow" && canvas.viewMode !== "storyboard") throw new Error("invalid canvas view mode");
    return { ...canvas, document };
  });
  if (!ids.has(workspace.activeCanvasId)) throw new Error("missing active canvas");
  return { version: 1, activeCanvasId: workspace.activeCanvasId, canvases };
}

/** Retain the active graph at the top level for existing project readers. */
export function serializeCanvasWorkspace(workspace: CanvasWorkspace, sanitizeNode: (node: CanvasDocument["nodes"][number]) => CanvasDocument["nodes"][number]) {
  const canvases = workspace.canvases.map((canvas) => ({ ...canvas, document: { ...canvas.document, nodes: canvas.document.nodes.map(sanitizeNode) } }));
  const active = canvases.find((canvas) => canvas.id === workspace.activeCanvasId);
  if (!active) throw new Error("missing active canvas");
  return JSON.stringify({ ...active.document, workspace: { ...workspace, canvases } });
}

export function captureWorkspaceCanvas(workspace: CanvasWorkspace, document: CanvasDocument, viewport: WorkspaceCanvas["viewport"], viewMode: CanvasViewMode): CanvasWorkspace {
  return { ...workspace, canvases: workspace.canvases.map((canvas) => canvas.id === workspace.activeCanvasId ? { ...canvas, document, viewport, viewMode } : canvas) };
}

export function renameWorkspaceCanvas(workspace: CanvasWorkspace, id: string, name: string): CanvasWorkspace {
  const trimmed = name.trim();
  if (!trimmed || !workspace.canvases.some((canvas) => canvas.id === id)) throw new Error("invalid canvas name or identity");
  return { ...workspace, canvases: workspace.canvases.map((canvas) => canvas.id === id ? { ...canvas, name: trimmed } : canvas) };
}

export function copyWorkspaceCanvas(workspace: CanvasWorkspace, sourceId: string, newId: string): CanvasWorkspace {
  const source = workspace.canvases.find((canvas) => canvas.id === sourceId);
  if (!source || !newId || workspace.canvases.some((canvas) => canvas.id === newId)) throw new Error("invalid canvas copy");
  const copy = structuredClone(source);
  const nodeIds = new Map(copy.document.nodes.map((node, index) => [node.id, `${newId}:node:${index}`]));
  copy.id = newId;
  let name = `${source.name} 副本`;
  for (let number = 2; workspace.canvases.some((canvas) => canvas.name === name); number += 1) name = `${source.name} 副本 ${number}`;
  copy.name = name;
  copy.document.nodes = copy.document.nodes.map((node) => {
    node.id = nodeIds.get(node.id)!;
    // A copy keeps results and parameters, never a live task or upload binding.
    if (node.status === "generating") node.status = node.imageSrc || node.videoSrc || node.audioSrc || node.modelSrc || node.content ? "success" : "idle";
    delete node.taskId;
    delete node.pendingGeneration;
    delete node.skillRunId;
    delete node.uploading;
    delete node.uploadProgress;
    if (node.clipReshootSourceId) node.clipReshootSourceId = nodeIds.get(node.clipReshootSourceId);
    if (node.storyboardFrame) node.storyboardFrame.sourceVideoId = nodeIds.get(node.storyboardFrame.sourceVideoId) || node.storyboardFrame.sourceVideoId;
    return node;
  });
  copy.document.connections = copy.document.connections.map((connection, index) => ({ ...connection, id: `${newId}:connection:${index}`, sourceId: nodeIds.get(connection.sourceId)!, targetId: nodeIds.get(connection.targetId)! })).filter((connection) => connection.sourceId && connection.targetId);
  copy.document.groups = copy.document.groups.map((group, index) => ({ ...group, id: `${newId}:group:${index}`, nodeIds: group.nodeIds.flatMap((id) => nodeIds.has(id) ? [nodeIds.get(id)!] : []) }));
  const sourceIndex = workspace.canvases.findIndex((canvas) => canvas.id === sourceId);
  const canvases = [...workspace.canvases];
  canvases.splice(sourceIndex + 1, 0, copy);
  return { ...workspace, activeCanvasId: newId, canvases };
}

export function deleteWorkspaceCanvas(workspace: CanvasWorkspace, id: string): CanvasWorkspace {
  const index = workspace.canvases.findIndex((canvas) => canvas.id === id);
  if (index < 0 || workspace.canvases.length <= 1) throw new Error("at least one canvas is required");
  const canvases = workspace.canvases.filter((canvas) => canvas.id !== id);
  return { ...workspace, canvases, activeCanvasId: workspace.activeCanvasId === id ? canvases[Math.min(index, canvases.length - 1)].id : workspace.activeCanvasId };
}

export function workspaceCanvasHref(token: string, canvasId: string): string {
  return `/canvas/${encodeURIComponent(token)}?canvas=${encodeURIComponent(canvasId)}`;
}
