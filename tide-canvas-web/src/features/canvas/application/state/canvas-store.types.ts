import type {
  CanvasGroup,
  CanvasHistorySnapshot,
  CanvasNode,
  CanvasSkillRunPersistence,
  Connection,
} from "../../domain/models/canvas-document";

export interface CanvasStoreState {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
  selectedNodeIds: Set<string>;
  /** 兼容旧调用：仅单选时存在。 */
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  currentProjectId: string | null;
  trackedSkillRunIds: string[];
  materializedArtifactIds: string[];
  undoStack: CanvasHistorySnapshot[];
  redoStack: CanvasHistorySnapshot[];

  addNode: (node: CanvasNode, recordHistory?: boolean) => void;
  addNodesAndConnections: (
    nodes: CanvasNode[],
    connections: Connection[],
    selectNodeId?: string,
  ) => void;
  updateNode: (id: string, data: Partial<CanvasNode>, recordHistory?: boolean) => void;
  updateNodePositions: (updates: Array<{ id: string; x: number; y: number }>) => void;
  removeNode: (id: string, recordHistory?: boolean) => void;
  removeNodes: (ids: string[]) => void;

  selectNode: (id: string | null) => void;
  toggleSelectNode: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;

  addConnection: (connection: Connection, recordHistory?: boolean) => void;
  removeConnection: (id: string, recordHistory?: boolean) => void;
  selectConnection: (id: string | null) => void;

  createGroup: (nodeIds: string[], title?: string) => string | null;
  updateGroup: (
    id: string,
    data: Partial<Pick<CanvasGroup, "title" | "color" | "nodeIds">>,
  ) => void;
  removeGroup: (id: string, deleteNodes?: boolean) => void;

  setCurrentProjectId: (id: string | null) => void;
  trackSkillRun: (runId: string) => void;
  settleSkillRun: (runId: string) => void;
  markSkillArtifactsMaterialized: (artifactIds: readonly string[]) => void;

  loadCanvas: (
    nodes: CanvasNode[],
    connections: Connection[],
    groups?: CanvasGroup[],
    skillRuns?: CanvasSkillRunPersistence,
  ) => void;
  clearCanvas: () => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}
