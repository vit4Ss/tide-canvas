import { create } from "zustand";
import type { CanvasGroup } from "@/features/canvas/domain/models/canvas-document";
import type { CanvasStoreState } from "@/features/canvas/application/state/canvas-store.types";
import {
  GROUP_COLORS,
  MAX_CANVAS_HISTORY,
  MAX_TRACKED_SKILL_RUNS,
  canvasHistorySnapshot,
  generateGroupId,
  generateNodeId,
  hasRecoverableGeneration,
  normalizeCanvasNode,
  normalizeCanvasNodePatch,
  pruneGroups,
  restoredSkillRunState,
  restoreHistoryNodes,
  reviveNode,
  uniqueNonEmptyStrings,
} from "@/features/canvas/application/state/canvas-state-helpers";

export type {
  CanvasGroup,
  CanvasNode,
  CanvasPendingGeneration,
  CanvasSkillRunPersistence,
  Connection,
} from "@/features/canvas/domain/models/canvas-document";

export { GROUP_COLORS, generateGroupId, generateNodeId, reviveNode };

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  nodes: [],
  connections: [],
  groups: [],
  selectedNodeIds: new Set(),
  selectedNodeId: null,
  selectedConnectionId: null,
  currentProjectId: null,
  trackedSkillRunIds: [],
  materializedArtifactIds: [],
  undoStack: [],
  redoStack: [],

  selectConnection: (id) => set((state) => {
    if (id === null) {
      return state.selectedConnectionId === null ? state : { selectedConnectionId: null };
    }
    if (
      state.selectedConnectionId === id &&
      state.selectedNodeIds.size === 0 &&
      state.selectedNodeId === null
    ) {
      return state;
    }
    // 节点与连线选择互斥。把约束放在 Store，而不是依赖每个事件调用方
    // 记得按正确顺序清理，避免受控 React Flow 出现两类元素同时高亮。
    return {
      selectedConnectionId: id,
      selectedNodeIds: new Set(),
      selectedNodeId: null,
    };
  }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  trackSkillRun: (runId) => set((state) => {
    if (!runId || state.trackedSkillRunIds.includes(runId)) return state;
    return {
      trackedSkillRunIds: [...state.trackedSkillRunIds, runId].slice(-MAX_TRACKED_SKILL_RUNS),
    };
  }),

  settleSkillRun: (runId) => set((state) => {
    const hasAnchor = state.nodes.some((node) => node.skillRunId === runId);
    const alreadyTracked = state.trackedSkillRunIds.includes(runId);
    if (!hasAnchor && alreadyTracked) return state;
    return {
      nodes: hasAnchor
        ? state.nodes.map((node) => node.skillRunId === runId ? { ...node, skillRunId: undefined } : node)
        : state.nodes,
      trackedSkillRunIds: alreadyTracked
        ? state.trackedSkillRunIds
        : [...state.trackedSkillRunIds, runId].slice(-MAX_TRACKED_SKILL_RUNS),
    };
  }),

  markSkillArtifactsMaterialized: (artifactIds) => set((state) => {
    const additions = uniqueNonEmptyStrings(artifactIds)
      .filter((artifactId) => !state.materializedArtifactIds.includes(artifactId));
    if (additions.length === 0) return state;
    return { materializedArtifactIds: [...state.materializedArtifactIds, ...additions] };
  }),

  pushHistory: () => set((state) => ({
    undoStack: [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)],
    redoStack: [],
  })),

  undo: () => set((state) => {
    if (state.undoStack.length === 0) return state;
    const prev = state.undoStack[state.undoStack.length - 1];
    const currentSnap = canvasHistorySnapshot(state);
    return {
      nodes: restoreHistoryNodes(state.nodes, prev.nodes),
      connections: prev.connections,
      groups: prev.groups,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnap],
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      // 回滚可能删掉当前选中的连线,悬空 id 会让 Delete 键触发无效删除并污染历史
      selectedConnectionId: null,
    };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    const next = state.redoStack[state.redoStack.length - 1];
    const currentSnap = canvasHistorySnapshot(state);
    return {
      nodes: restoreHistoryNodes(state.nodes, next.nodes),
      connections: next.connections,
      groups: next.groups,
      undoStack: [...state.undoStack, currentSnap],
      redoStack: state.redoStack.slice(0, -1),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: null,
    };
  }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  addNode: (node, recordHistory = true) => set((state) => {
    const undo = recordHistory
      ? [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)]
      : state.undoStack;
    return {
      nodes: [...state.nodes, normalizeCanvasNode(node)],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  addNodesAndConnections: (nodes, connections, selectNodeId) => set((state) => {
    const existingNodeIds = new Set(state.nodes.map((node) => node.id));
    const nextNodes = nodes.filter((node, index, list) =>
      !existingNodeIds.has(node.id) && list.findIndex((candidate) => candidate.id === node.id) === index,
    );
    const availableNodeIds = new Set([...existingNodeIds, ...nextNodes.map((node) => node.id)]);
    const existingConnectionIds = new Set(state.connections.map((connection) => connection.id));
    const existingPairs = new Set(state.connections.map((connection) => `${connection.sourceId}\u0000${connection.targetId}\u0000${connection.targetSlot ?? ""}`));
    const nextConnections = connections.filter((connection, index, list) => {
      if (!availableNodeIds.has(connection.sourceId) || !availableNodeIds.has(connection.targetId)) return false;
      if (existingConnectionIds.has(connection.id)) return false;
      const pair = `${connection.sourceId}\u0000${connection.targetId}\u0000${connection.targetSlot ?? ""}`;
      if (existingPairs.has(pair)) return false;
      return list.findIndex((candidate) =>
        `${candidate.sourceId}\u0000${candidate.targetId}\u0000${candidate.targetSlot ?? ""}` === pair,
      ) === index;
    });
    if (nextNodes.length === 0 && nextConnections.length === 0) return state;

    const canSelect = !!selectNodeId && availableNodeIds.has(selectNodeId);
    return {
      nodes: [...state.nodes, ...nextNodes.map(normalizeCanvasNode)],
      connections: [...state.connections, ...nextConnections],
      selectedNodeId: canSelect ? selectNodeId! : state.selectedNodeId,
      selectedNodeIds: canSelect ? new Set([selectNodeId]) : state.selectedNodeIds,
      selectedConnectionId: canSelect ? null : state.selectedConnectionId,
      undoStack: [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)],
      redoStack: [],
    };
  }),

  updateNode: (id, data, recordHistory = false) => set((state) => {
    // 拖拽更新太频繁，默认不记录历史
    const undo = recordHistory
      ? [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)]
      : state.undoStack;
    return {
      nodes: state.nodes.map((node) => (
        node.id === id
          ? normalizeCanvasNode({ ...node, ...normalizeCanvasNodePatch(data) })
          : node
      )),
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
    // 目标不存在时不做空操作:否则仍会压一条无效历史并清掉 redo 栈
    const target = state.nodes.find((n) => n.id === id);
    if (!target || hasRecoverableGeneration(target)) return state;
    const newSel = new Set(state.selectedNodeIds);
    newSel.delete(id);
    const undo = recordHistory
      ? [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)]
      : state.undoStack;
    const connections = state.connections.filter((c) => c.sourceId !== id && c.targetId !== id);
    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      connections,
      groups: pruneGroups(state.groups, new Set([id])),
      selectedNodeIds: newSel,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      // 选中的连线可能随节点一起被删,悬空引用需同步清掉
      selectedConnectionId: connections.some((c) => c.id === state.selectedConnectionId)
        ? state.selectedConnectionId
        : null,
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeNodes: (ids) => set((state) => {
    const requested = new Set(ids);
    const idSet = new Set(
      state.nodes
        .filter((node) => requested.has(node.id) && !hasRecoverableGeneration(node))
        .map((node) => node.id),
    );
    if (idSet.size === 0) return state;
    const connections = state.connections.filter((c) => !idSet.has(c.sourceId) && !idSet.has(c.targetId));
    return {
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      connections,
      groups: pruneGroups(state.groups, idSet),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: connections.some((c) => c.id === state.selectedConnectionId)
        ? state.selectedConnectionId
        : null,
      undoStack: [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)],
      redoStack: [],
    };
  }),

  selectNode: (id) => set((state) => ({
    selectedNodeId: id,
    selectedNodeIds: id ? new Set([id]) : new Set(),
    selectedConnectionId: id ? null : state.selectedConnectionId,
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
      selectedConnectionId: newSel.size > 0 ? null : state.selectedConnectionId,
    };
  }),

  selectMany: (ids) => set((state) => {
    const selectedNodeIds = new Set(ids);
    return {
      selectedNodeIds,
      selectedNodeId: selectedNodeIds.size === 1
        ? selectedNodeIds.values().next().value ?? null
        : null,
      // 空节点选择可能紧随“选择连线”事件到达，不能把刚选中的连线清掉。
      selectedConnectionId: selectedNodeIds.size > 0 ? null : state.selectedConnectionId,
    };
  }),

  clearSelection: () => set({
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    selectedConnectionId: null,
  }),

  selectAll: () => set((state) => ({
    selectedNodeIds: new Set(state.nodes.map((n) => n.id)),
    selectedNodeId: state.nodes.length === 1 ? state.nodes[0].id : null,
    selectedConnectionId: null,
  })),

  addConnection: (conn, recordHistory = true) => set((state) => {
    const undo = recordHistory
      ? [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)]
      : state.undoStack;
    return {
      connections: [...state.connections, conn],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeConnection: (id, recordHistory = true) => set((state) => {
    // 悬空 id(如撤销掉选中连线后按 Delete)不做空操作,避免压无效历史清掉 redo
    if (!state.connections.some((c) => c.id === id)) return state;
    const undo = recordHistory
      ? [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)]
      : state.undoStack;
    return {
      connections: state.connections.filter((c) => c.id !== id),
      selectedConnectionId: state.selectedConnectionId === id ? null : state.selectedConnectionId,
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
      undoStack: [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)],
      redoStack: [],
    });
    return id;
  },

  updateGroup: (id, data) => set((state) => ({
    groups: state.groups.map((g) => (g.id === id ? { ...g, ...data } : g)),
    undoStack: [...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1), canvasHistorySnapshot(state)],
    redoStack: [],
  })),

  removeGroup: (id, deleteNodes = false) => set((state) => {
    const group = state.groups.find((g) => g.id === id);
    const undo = [
      ...state.undoStack.slice(-MAX_CANVAS_HISTORY + 1),
      canvasHistorySnapshot(state),
    ];
    if (group && deleteNodes) {
      const requested = new Set(group.nodeIds);
      const memberIds = new Set(
        state.nodes
          .filter((node) => requested.has(node.id) && !hasRecoverableGeneration(node))
          .map((node) => node.id),
      );
      const connections = state.connections.filter(
        (connection) => !memberIds.has(connection.sourceId) && !memberIds.has(connection.targetId),
      );
      return {
        nodes: state.nodes.filter((n) => !memberIds.has(n.id)),
        connections,
        groups: state.groups.filter((g) => g.id !== id),
        selectedNodeIds: new Set(),
        selectedNodeId: null,
        selectedConnectionId: connections.some((connection) => connection.id === state.selectedConnectionId)
          ? state.selectedConnectionId
          : null,
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

  loadCanvas: (nodes, connections, groups = [], skillRuns) => {
    const restoredNodes = nodes.map((node) => (
      reviveNode(normalizeCanvasNode(node), { keepResumable: true })
    ));
    const restoredRuns = restoredSkillRunState(restoredNodes, skillRuns);
    set({
      nodes: restoredNodes,
      connections,
      groups: (groups || []).filter((g) => g && Array.isArray(g.nodeIds) && g.nodeIds.length > 0),
      trackedSkillRunIds: restoredRuns.trackedRunIds,
      materializedArtifactIds: restoredRuns.materializedArtifactIds,
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  clearCanvas: () => set({
    nodes: [],
    connections: [],
    groups: [],
    trackedSkillRunIds: [],
    materializedArtifactIds: [],
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    selectedConnectionId: null,
    undoStack: [],
    redoStack: [],
  }),
}));
