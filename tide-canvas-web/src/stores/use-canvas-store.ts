import { create } from "zustand";

export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  prompt?: string;
  imageSrc?: string;
  videoSrc?: string;
  status?: "idle" | "generating" | "success" | "error";
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
}

interface HistorySnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
}

interface CanvasState {
  nodes: CanvasNode[];
  connections: Connection[];
  selectedNodeIds: Set<string>;
  selectedNodeId: string | null; // 兼容字段：单选时为该 ID
  selectedConnectionId: string | null;
  transform: { x: number; y: number; k: number };
  /** 当前画布项目数值ID（字符串，雪花），供生成/历史按画布过滤 */
  currentProjectId: string | null;

  // 历史栈
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  // 节点操作
  addNode: (node: CanvasNode, recordHistory?: boolean) => void;
  updateNode: (id: string, data: Partial<CanvasNode>, recordHistory?: boolean) => void;
  /** 批量移动节点位置（拖拽多选时使用，单次 set，不记录历史） */
  updateNodePositions: (updates: Array<{ id: string; x: number; y: number }>) => void;
  removeNode: (id: string, recordHistory?: boolean) => void;
  removeNodes: (ids: string[]) => void;

  // 选择操作
  selectNode: (id: string | null) => void;
  toggleSelectNode: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // 连接操作
  addConnection: (conn: Connection, recordHistory?: boolean) => void;
  removeConnection: (id: string, recordHistory?: boolean) => void;
  selectConnection: (id: string | null) => void;

  // 视口
  setTransform: (transform: { x: number; y: number; k: number }) => void;
  setCurrentProjectId: (id: string | null) => void;

  // 画布加载/清空
  loadCanvas: (nodes: CanvasNode[], connections: Connection[]) => void;
  clearCanvas: () => void;

  // Undo/Redo
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let nodeCounter = 0;
const MAX_HISTORY = 50;

export function generateNodeId(): string {
  return `node_${Date.now()}_${++nodeCounter}`;
}

/** 拷贝当前 nodes+connections 用于历史快照 */
function snapshot(state: { nodes: CanvasNode[]; connections: Connection[] }): HistorySnapshot {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    connections: state.connections.map((c) => ({ ...c })),
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  connections: [],
  selectedNodeIds: new Set(),
  selectedNodeId: null,
  selectedConnectionId: null,
  transform: { x: 0, y: 0, k: 1 },
  currentProjectId: null,
  undoStack: [],
  redoStack: [],

  selectConnection: (id) => set({ selectedConnectionId: id }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  pushHistory: () => set((state) => ({
    undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
    redoStack: [],
  })),

  undo: () => set((state) => {
    if (state.undoStack.length === 0) return state;
    const prev = state.undoStack[state.undoStack.length - 1];
    const currentSnap = snapshot(state);
    return {
      nodes: prev.nodes,
      connections: prev.connections,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnap],
      selectedNodeIds: new Set(),
      selectedNodeId: null,
    };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    const next = state.redoStack[state.redoStack.length - 1];
    const currentSnap = snapshot(state);
    return {
      nodes: next.nodes,
      connections: next.connections,
      undoStack: [...state.undoStack, currentSnap],
      redoStack: state.redoStack.slice(0, -1),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
    };
  }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  addNode: (node, recordHistory = true) => set((state) => {
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      nodes: [...state.nodes, node],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  updateNode: (id, data, recordHistory = false) => set((state) => {
    // 拖拽更新太频繁，默认不记录历史
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...data } : n)),
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  updateNodePositions: (updates) => set((state) => {
    if (updates.length === 0) return state;
    const map = new Map(updates.map((u) => [u.id, u]));
    return {
      nodes: state.nodes.map((n) => {
        const u = map.get(n.id);
        return u ? { ...n, x: u.x, y: u.y } : n;
      }),
    };
  }),

  removeNode: (id, recordHistory = true) => set((state) => {
    const newSel = new Set(state.selectedNodeIds);
    newSel.delete(id);
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      connections: state.connections.filter((c) => c.sourceId !== id && c.targetId !== id),
      selectedNodeIds: newSel,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeNodes: (ids) => set((state) => {
    const idSet = new Set(ids);
    return {
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      connections: state.connections.filter((c) => !idSet.has(c.sourceId) && !idSet.has(c.targetId)),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    };
  }),

  selectNode: (id) => set(() => ({
    selectedNodeId: id,
    selectedNodeIds: id ? new Set([id]) : new Set(),
  })),

  toggleSelectNode: (id) => set((state) => {
    const newSel = new Set(state.selectedNodeIds);
    if (newSel.has(id)) {
      newSel.delete(id);
    } else {
      newSel.add(id);
    }
    return {
      selectedNodeIds: newSel,
      selectedNodeId: newSel.size === 1 ? Array.from(newSel)[0] : null,
    };
  }),

  selectMany: (ids) => set(() => ({
    selectedNodeIds: new Set(ids),
    selectedNodeId: ids.length === 1 ? ids[0] : null,
  })),

  clearSelection: () => set({ selectedNodeIds: new Set(), selectedNodeId: null }),

  selectAll: () => set((state) => ({
    selectedNodeIds: new Set(state.nodes.map((n) => n.id)),
    selectedNodeId: state.nodes.length === 1 ? state.nodes[0].id : null,
  })),

  addConnection: (conn, recordHistory = true) => set((state) => {
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      connections: [...state.connections, conn],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeConnection: (id, recordHistory = true) => set((state) => {
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      connections: state.connections.filter((c) => c.id !== id),
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  setTransform: (transform) => set({ transform }),

  loadCanvas: (nodes, connections) => set({
    nodes,
    connections,
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    undoStack: [],
    redoStack: [],
  }),

  clearCanvas: () => set({
    nodes: [],
    connections: [],
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    undoStack: [],
    redoStack: [],
  }),
}));
