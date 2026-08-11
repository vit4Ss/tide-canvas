"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  type Connection as ReactFlowConnection,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { createNode } from "@/lib/canvas-helpers";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { useCanvasStore } from "@/stores/use-canvas-store";
import type { CanvasNode, Connection } from "../../domain/models/canvas-document";
import {
  toCanvasFlowEdges,
  toCanvasFlowNodes,
} from "../../infrastructure/react-flow/canvas-flow-adapter";
import type { CanvasFlowEdge, CanvasFlowNode } from "../../infrastructure/react-flow/canvas-flow-types";

export interface QuickAddIntent {
  sourceNodeId: string;
  sourceSide: "input" | "output";
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
}

interface CanvasPoint {
  x: number;
  y: number;
}

interface UseCanvasFlowControllerOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  nodes: readonly CanvasNode[];
  connections: readonly Connection[];
  selectedNodeIds: ReadonlySet<string>;
  selectedConnectionId: string | null;
  screenToWorld: (clientX: number, clientY: number) => CanvasPoint;
  closeTransientUi: () => void;
}

export interface CanvasFlowController {
  flowNodes: CanvasFlowNode[];
  flowEdges: CanvasFlowEdge[];
  quickAdd: QuickAddIntent | null;
  setQuickAdd: Dispatch<SetStateAction<QuickAddIntent | null>>;
  isNodeDragging: boolean;
  handleQuickAdd: (type: string) => void;
  handleNodesChange: (changes: NodeChange<CanvasFlowNode>[]) => void;
  handleEdgesChange: (changes: EdgeChange<CanvasFlowEdge>[]) => void;
  handleNodeDragStart: () => void;
  handleNodeDragStop: () => void;
  handleConnect: (connection: ReactFlowConnection) => void;
  handleConnectEnd: OnConnectEnd;
  handlePaneClick: () => void;
  handleInit: (instance: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge>) => void;
  handleMove: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function clientPointOf(event: MouseEvent | TouchEvent): CanvasPoint | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

export function useCanvasFlowController({
  containerRef,
  nodes,
  connections,
  selectedNodeIds,
  selectedConnectionId,
  screenToWorld,
  closeTransientUi,
}: UseCanvasFlowControllerOptions): CanvasFlowController {
  const [quickAdd, setQuickAdd] = useState<QuickAddIntent | null>(null);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const draggingRef = useRef(false);

  const flowNodes = useMemo(
    () => toCanvasFlowNodes(nodes, selectedNodeIds),
    [nodes, selectedNodeIds],
  );
  const flowEdges = useMemo(
    () => toCanvasFlowEdges(connections, nodes, selectedNodeIds, selectedConnectionId),
    [connections, nodes, selectedConnectionId, selectedNodeIds],
  );

  const handleQuickAdd = useCallback((type: string): void => {
    if (!quickAdd) return;
    const snapshot = useCanvasStore.getState();
    const node = createNode(type, quickAdd.worldX, quickAdd.worldY, snapshot.nodes);
    snapshot.addNode(node);
    const sourceId = quickAdd.sourceSide === "output" ? quickAdd.sourceNodeId : node.id;
    const targetId = quickAdd.sourceSide === "output" ? node.id : quickAdd.sourceNodeId;
    if (sourceId !== targetId) {
      snapshot.addConnection({
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceId,
        targetId,
      });
    }
    snapshot.selectNode(node.id);
    setQuickAdd(null);
  }, [quickAdd]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]): void => {
    const updates: Array<{ id: string; x: number; y: number }> = [];
    const selectionChanges = changes.filter((change) => change.type === "select");
    changes.forEach((change) => {
      if (change.type === "position" && change.position) {
        updates.push({ id: change.id, x: change.position.x, y: change.position.y });
      }
    });

    const store = useCanvasStore.getState();
    if (updates.length > 0) store.updateNodePositions(updates);

    // React Flow 当前使用受控 nodes：交互变更不会自动写回传入的 nodes，必须由
    // onNodesChange 显式映射到领域 store。dimensions 只用于 React Flow 内部测量；
    // add/remove/replace 由项目命令负责，当前交互配置不会从框架侧产生。
    if (selectionChanges.length > 0) {
      const nextSelectedIds = new Set(store.selectedNodeIds);
      selectionChanges.forEach((change) => {
        if (change.selected) nextSelectedIds.add(change.id);
        else nextSelectedIds.delete(change.id);
      });
      if (!sameStringSet(store.selectedNodeIds, nextSelectedIds)) {
        store.selectMany([...nextSelectedIds]);
      }
    }
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]): void => {
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length === 0) return;

    const store = useCanvasStore.getState();
    // 领域模型只支持单条连线选择。批量变化时优先采用本批次中新选中的连线；
    // 若只是取消当前连线，则清空。其它边的取消通知不得误清当前选择。
    const selectedChange = selectionChanges.find((change) => change.selected);
    const currentDeselected = selectionChanges.some(
      (change) => !change.selected && change.id === store.selectedConnectionId,
    );
    const nextSelectedId = selectedChange?.id ?? (currentDeselected ? null : store.selectedConnectionId);
    if (nextSelectedId !== store.selectedConnectionId) store.selectConnection(nextSelectedId);
  }, []);

  const handleNodeDragStart = useCallback((): void => {
    if (draggingRef.current) return;
    draggingRef.current = true;
    setIsNodeDragging(true);
    useCanvasStore.getState().pushHistory();
  }, []);

  const handleNodeDragStop = useCallback((): void => {
    draggingRef.current = false;
    setIsNodeDragging(false);
  }, []);

  const handleConnect = useCallback((connection: ReactFlowConnection): void => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const store = useCanvasStore.getState();
    const duplicate = store.connections.some(
      (item) => item.sourceId === connection.source && item.targetId === connection.target,
    );
    if (duplicate) return;
    store.addConnection({
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceId: connection.source,
      targetId: connection.target,
      ...(connection.sourceHandle && connection.sourceHandle !== "output"
        ? { sourceOutput: connection.sourceHandle }
        : {}),
      ...(connection.targetHandle && connection.targetHandle !== "input"
        ? { targetSlot: connection.targetHandle }
        : {}),
    });
  }, []);

  const handleConnectEnd = useCallback<OnConnectEnd>((event, state) => {
    if (!state.fromNode || state.toNode) return;
    const client = clientPointOf(event);
    if (!client) return;
    const world = screenToWorld(client.x, client.y);
    if (Math.hypot(world.x - state.from.x, world.y - state.from.y) <= 24) return;
    setQuickAdd({
      sourceNodeId: state.fromNode.id,
      sourceSide: state.fromHandle.type === "target" ? "input" : "output",
      clientX: client.x,
      clientY: client.y,
      worldX: world.x,
      worldY: world.y,
    });
  }, [screenToWorld]);

  const handlePaneClick = useCallback((): void => {
    // 先触发编辑控件的 blur 提交，再清空受控选择，避免仅视觉取消选中但焦点仍被保留。
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      containerRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
    closeTransientUi();
    setQuickAdd(null);
    const store = useCanvasStore.getState();
    store.clearSelection();
  }, [closeTransientUi, containerRef]);

  const handleMove = useCallback((
    _event: MouseEvent | TouchEvent | null,
    viewport: Viewport,
  ): void => {
    useCanvasViewStore.getState().setTransform({
      x: viewport.x,
      y: viewport.y,
      k: viewport.zoom,
    });
    const host = containerRef.current;
    if (!host) return;
    host.style.setProperty("--nc-inv", String(1 / viewport.zoom));
    host.style.setProperty(
      "--nc-inv-damp",
      String(viewport.zoom > 1 ? Math.pow(viewport.zoom, -0.6) : 1 / viewport.zoom),
    );
  }, [containerRef]);

  const handleInit = useCallback((
    instance: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge>,
  ): void => {
    handleMove(null, instance.getViewport());
  }, [handleMove]);

  return {
    flowNodes,
    flowEdges,
    quickAdd,
    setQuickAdd,
    isNodeDragging,
    handleQuickAdd,
    handleNodesChange,
    handleEdgesChange,
    handleNodeDragStart,
    handleNodeDragStop,
    handleConnect,
    handleConnectEnd,
    handlePaneClick,
    handleInit,
    handleMove,
  };
}
