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
  /** 语音合成结果（audio 节点） */
  audioSrc?: string;
  status?: "idle" | "generating" | "success" | "error";
  /** 生成时选择的目标画幅；有值时图片节点按该画幅展示，避免结果卡片被自然尺寸改成其它比例 */
  aspectRatio?: string;
  /** 卡片实际渲染尺寸（按图片比例计算）；供连线层把端点锚定到卡片真实边缘中点，实现默认居中对齐 */
  contentW?: number;
  contentH?: number;
  /** 是否为 360° 全景扩图（image 节点）；为 true 时「全景」按钮直接进 360 查看而非重新生成 */
  is360?: boolean;
  /** 导演台(scene_3d)状态：JSON 字符串（各关节欧拉角/相机球坐标+target/灯光/可选 modelSrc）。
   *  单字段随节点自动序列化保存，无需后端改动；防御性 parse。 */
  scene3d?: string;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
}

/** 分组（libTV 风格）：标题栏 + 自动外扩边框紧贴成员包围盒。一个节点至多属于一个分组。 */
export interface CanvasGroup {
  id: string;
  title: string;
  /** 边框/标题色（hex） */
  color: string;
  /** 成员节点 id（显式归属；边框由成员位置实时计算） */
  nodeIds: string[];
}

interface HistorySnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
}

interface CanvasState {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
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

  // 分组操作
  /** 用给定节点创建分组（自动从其它分组中移出这些节点、剔除空分组）；返回新分组 id */
  createGroup: (nodeIds: string[], title?: string) => string | null;
  updateGroup: (id: string, data: Partial<Pick<CanvasGroup, "title" | "color" | "nodeIds">>) => void;
  /** 解组：删除分组框；deleteNodes=true 时连同成员节点一并删除 */
  removeGroup: (id: string, deleteNodes?: boolean) => void;

  // 视口
  setTransform: (transform: { x: number; y: number; k: number }) => void;
  setCurrentProjectId: (id: string | null) => void;

  // 画布加载/清空
  loadCanvas: (nodes: CanvasNode[], connections: Connection[], groups?: CanvasGroup[]) => void;
  clearCanvas: () => void;

  // Undo/Redo
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let nodeCounter = 0;
let groupCounter = 0;
const MAX_HISTORY = 50;

/** 分组默认配色（按现有分组数轮转，相邻分组颜色不同） */
export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];

export function generateNodeId(): string {
  return `node_${Date.now()}_${++nodeCounter}`;
}

export function generateGroupId(): string {
  return `group_${Date.now()}_${++groupCounter}`;
}

/** 从各分组中剔除指定节点 id，并丢弃因此变空的分组 */
function pruneGroups(groups: CanvasGroup[], removed: Set<string>): CanvasGroup[] {
  if (removed.size === 0) return groups;
  return groups
    .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !removed.has(id)) }))
    .filter((g) => g.nodeIds.length > 0);
}

/** 拷贝当前 nodes+connections+groups 用于历史快照 */
function snapshot(state: { nodes: CanvasNode[]; connections: Connection[]; groups: CanvasGroup[] }): HistorySnapshot {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    connections: state.connections.map((c) => ({ ...c })),
    groups: state.groups.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })),
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  connections: [],
  groups: [],
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
      groups: prev.groups,
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
      groups: next.groups,
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
      groups: pruneGroups(state.groups, new Set([id])),
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
      groups: pruneGroups(state.groups, idSet),
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

  createGroup: (nodeIds, title) => {
    const state = get();
    const valid = nodeIds.filter((id) => state.nodes.some((n) => n.id === id));
    if (valid.length === 0) return null;
    const idSet = new Set(valid);
    const id = generateGroupId();
    // 先把这些节点从其它分组移出（保证唯一归属），再追加新分组
    const cleaned = pruneGroups(state.groups, idSet);
    const color = GROUP_COLORS[state.groups.length % GROUP_COLORS.length];
    const group: CanvasGroup = { id, title: title || "未命名分组", color, nodeIds: valid };
    set({
      groups: [...cleaned, group],
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    });
    return id;
  },

  updateGroup: (id, data) => set((state) => ({
    groups: state.groups.map((g) => (g.id === id ? { ...g, ...data } : g)),
    undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
    redoStack: [],
  })),

  removeGroup: (id, deleteNodes = false) => set((state) => {
    const group = state.groups.find((g) => g.id === id);
    const undo = [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)];
    if (group && deleteNodes) {
      const memberIds = new Set(group.nodeIds);
      return {
        nodes: state.nodes.filter((n) => !memberIds.has(n.id)),
        connections: state.connections.filter((c) => !memberIds.has(c.sourceId) && !memberIds.has(c.targetId)),
        groups: state.groups.filter((g) => g.id !== id),
        selectedNodeIds: new Set(),
        selectedNodeId: null,
        undoStack: undo,
        redoStack: [],
      };
    }
    return {
      groups: state.groups.filter((g) => g.id !== id),
      undoStack: undo,
      redoStack: [],
    };
  }),

  setTransform: (transform) => set({ transform }),

  loadCanvas: (nodes, connections, groups = []) => set({
    // 统一图片/视频节点为标准大小 608×342（清掉旧 contentW/contentH，由渲染按图片比例重算）
    nodes: nodes.map((n) =>
      n.type === "image" || n.type === "video"
        ? { ...n, width: 608, height: 342, contentW: undefined, contentH: undefined }
        : n
    ),
    connections,
    groups: (groups || []).filter((g) => g && Array.isArray(g.nodeIds) && g.nodeIds.length > 0),
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    undoStack: [],
    redoStack: [],
  }),

  clearCanvas: () => set({
    nodes: [],
    connections: [],
    groups: [],
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    undoStack: [],
    redoStack: [],
  }),
}));
