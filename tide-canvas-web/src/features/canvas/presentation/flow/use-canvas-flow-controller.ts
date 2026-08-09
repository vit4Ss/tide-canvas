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
  handleSelectionChange: (selection: { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] }) => void;
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
    () => toCanvasFlowEdges(connections, selectedNodeIds, selectedConnectionId),
    [connections, selectedConnectionId, selectedNodeIds],
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
    changes.forEach((change) => {
      if (change.type === "position" && change.position) {
        updates.push({ id: change.id, x: change.position.x, y: change.position.y });
      }
    });
    if (updates.length > 0) useCanvasStore.getState().updateNodePositions(updates);
  }, []);

  const handleSelectionChange = useCallback((selection: {
    nodes: CanvasFlowNode[];
    edges: CanvasFlowEdge[];
  }): void => {
    const store = useCanvasStore.getState();
    const nodeIds = new Set(selection.nodes.map((node) => node.id));
    const edgeId = selection.edges[0]?.id ?? null;
    if (!sameStringSet(store.selectedNodeIds, nodeIds)) store.selectMany([...nodeIds]);
    if (store.selectedConnectionId !== edgeId) store.selectConnection(edgeId);
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
    closeTransientUi();
    setQuickAdd(null);
    const store = useCanvasStore.getState();
    store.clearSelection();
    store.selectConnection(null);
  }, [closeTransientUi]);

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
    handleSelectionChange,
    handleNodeDragStart,
    handleNodeDragStop,
    handleConnect,
    handleConnectEnd,
    handlePaneClick,
    handleInit,
    handleMove,
  };
}
