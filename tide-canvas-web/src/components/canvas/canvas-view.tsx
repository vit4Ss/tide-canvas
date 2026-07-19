"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Group } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  useOnViewportChange,
  useReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
  type OnConnectStartParams,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasClipboard } from "@/hooks/canvas/use-canvas-clipboard";
import { useCanvasKeyboard } from "@/hooks/canvas/use-canvas-keyboard";
import { createNode, autoArrangeNodes } from "@/lib/canvas-helpers";
import { CanvasEmptyState } from "./canvas-empty-state";
import { CanvasGroupsLayer } from "./canvas-groups-layer";
import { CanvasContextMenu, type ContextMenuState } from "./canvas-context-menu";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { MyAssetsPanel } from "./my-assets-panel";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { FileType, type FileVO } from "@/types/file";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { CanvasQuickAddMenu } from "./canvas-quick-add-menu";
import { CanvasAssistantPanel } from "./canvas-assistant-panel";
import { ReactFlowCanvasNode, type TideFlowNode } from "./react-flow-canvas-node";

type TideFlowEdge = Edge<Record<string, never>, "default">;

interface QuickAddState {
  sourceNodeId: string;
  sourceSide: "input" | "output";
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
}

const NODE_TYPES: NodeTypes = {
  tideCanvasNode: ReactFlowCanvasNode,
};

const SNAP_GRID: [number, number] = [20, 20];

function getClientPoint(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0] || event.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

function makeConnectionId(sourceId: string, targetId: string) {
  return `conn_${sourceId}_${targetId}_${Date.now().toString(36)}`;
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasViewInner />
    </ReactFlowProvider>
  );
}

function CanvasViewInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactFlow = useReactFlow<TideFlowNode, TideFlowEdge>();
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const initialTransform = useCanvasStore((s) => s.transform);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectMany = useCanvasStore((s) => s.selectMany);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const selectConnection = useCanvasStore((s) => s.selectConnection);
  const addConnection = useCanvasStore((s) => s.addConnection);
  const updateNodePositions = useCanvasStore((s) => s.updateNodePositions);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canUndo = useCanvasStore((s) => s.undoStack.length > 0);
  const canRedo = useCanvasStore((s) => s.redoStack.length > 0);

  const [gridSnap, setGridSnap] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [myAssetsOpen, setMyAssetsOpen] = useState(false);
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: initialTransform.x, y: initialTransform.y, zoom: initialTransform.k });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const connectionStartRef = useRef<{ nodeId: string; side: "input" | "output" } | null>(null);
  const clipboard = useCanvasClipboard();

  useCanvasKeyboard({ onEscape: () => { setContextMenu(null); setQuickAdd(null); } });

  useOnViewportChange({
    onChange: (nextViewport) => {
      setViewport(nextViewport);
      useCanvasStore.getState().setTransform({
        x: nextViewport.x,
        y: nextViewport.y,
        k: nextViewport.zoom,
      });
    },
  });

  const flowNodes = useMemo<TideFlowNode[]>(
    () => nodes.map((node) => ({
      id: node.id,
      type: "tideCanvasNode",
      position: { x: node.x, y: node.y },
      data: { node },
      style: {
        width: node.contentW ?? node.width,
        height: node.contentH ?? node.height,
      },
      selected: selectedNodeIds.has(node.id),
      draggable: true,
      selectable: true,
      deletable: false,
    })),
    [nodes, selectedNodeIds],
  );

  const flowEdges = useMemo<TideFlowEdge[]>(
    () => connections.map((connection) => ({
      id: connection.id,
      source: connection.sourceId,
      target: connection.targetId,
      sourceHandle: "output",
      targetHandle: "input",
      type: "default",
      selected: selectedConnectionId === connection.id,
      animated: selectedNodeIds.has(connection.sourceId) || selectedNodeIds.has(connection.targetId),
      style: {
        stroke: selectedConnectionId === connection.id ? "#3b82f6" : "#9ca3af",
        strokeWidth: selectedConnectionId === connection.id ? 2.5 : 2,
      },
    })),
    [connections, selectedConnectionId, selectedNodeIds],
  );

  const screenToFlowPoint = useCallback((clientX: number, clientY: number) => (
    reactFlow.screenToFlowPosition({ x: clientX, y: clientY })
  ), [reactFlow]);

  const getViewportCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return screenToFlowPoint(x, y);
  }, [screenToFlowPoint]);

  const handleAddNode = useCallback((type: string, worldX: number, worldY: number) => {
    const node = createNode(type, worldX, worldY, useCanvasStore.getState().nodes);
    addNode(node);
    selectNode(node.id);
  }, [addNode, selectNode]);

  const addNodeAtViewportCenter = useCallback((type: string) => {
    const world = getViewportCenter();
    handleAddNode(type, world.x, world.y);
  }, [getViewportCenter, handleAddNode]);

  const addAssetToCanvas = useCallback((file: FileVO) => {
    const world = getViewportCenter();
    const type = file.fileType === FileType.VIDEO ? "video" : "image";
    const node = createNode(type, world.x, world.y, useCanvasStore.getState().nodes);
    if (type === "video") {
      node.videoSrc = file.fileUrl;
    } else {
      node.imageSrc = file.fileUrl;
    }
    node.status = "success";
    node.fileSize = file.fileSize;
    node.fileType = file.fileType;
    node.mimeType = file.mimeType;
    addNode(node);
    selectNode(node.id);
  }, [addNode, getViewportCenter, selectNode]);

  const addGeneratedResourceToCanvas = useCallback((resource: { url: string; kind: "image" | "video"; title: string }) => {
    const world = getViewportCenter();
    const node = createNode(resource.kind, world.x, world.y, useCanvasStore.getState().nodes);
    node.title = resource.title || (resource.kind === "video" ? "视频节点" : "图片节点");
    node.status = "success";
    node.fileType = resource.kind;
    if (resource.kind === "video") {
      node.videoSrc = resource.url;
    } else {
      node.imageSrc = resource.url;
    }
    addNode(node);
    selectNode(node.id);
  }, [addNode, getViewportCenter, selectNode]);

  const handleSaveAsset = useCallback(async () => {
    const node = nodes.find((n) => n.id === contextMenu?.nodeId);
    const url = node?.videoSrc || node?.imageSrc;
    if (!url) {
      toast.info("该节点暂无可保存的图片/视频");
      return;
    }
    const res = await fileApi.saveFromUrl({
      url,
      fileType: node?.videoSrc ? "video" : "image",
      originalName: node?.title,
    });
    if (res.success) {
      toast.success("已保存到我的素材");
      setMyAssetsOpen(true);
      setAssetsRefreshKey((key) => key + 1);
    } else {
      toast.error(res.message || "保存失败");
    }
  }, [contextMenu?.nodeId, nodes]);

  const openContextMenu = useCallback((event: React.MouseEvent | MouseEvent, nodeId?: string) => {
    event.preventDefault();
    const world = screenToFlowPoint(event.clientX, event.clientY);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      type: nodeId ? "node" : "canvas",
      nodeId,
    });
  }, [screenToFlowPoint]);

  const handleNodesChange = useCallback((changes: NodeChange<TideFlowNode>[]) => {
    const updates = changes.flatMap((change) => {
      if (change.type !== "position" || !change.position) return [];
      return [{ id: change.id, x: change.position.x, y: change.position.y }];
    });
    if (updates.length > 0) {
      updateNodePositions(updates);
    }

    const removed = changes.flatMap((change) => (change.type === "remove" ? [change.id] : []));
    if (removed.length > 0) {
      useCanvasStore.getState().removeNodes(removed);
    }
  }, [updateNodePositions]);

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams<TideFlowNode, TideFlowEdge>) => {
    selectMany(params.nodes.map((node) => node.id));
    selectConnection(params.edges[0]?.id ?? null);
  }, [selectConnection, selectMany]);

  const handleConnect = useCallback((params: FlowConnection) => {
    if (!params.source || !params.target || params.source === params.target) return;
    const exists = useCanvasStore.getState().connections.some(
      (connection) => connection.sourceId === params.source && connection.targetId === params.target,
    );
    if (exists) {
      setQuickAdd(null);
      return;
    }
    addConnection({
      id: makeConnectionId(params.source, params.target),
      sourceId: params.source,
      targetId: params.target,
    });
    setQuickAdd(null);
  }, [addConnection]);

  const handleConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    if (!params.nodeId) return;
    connectionStartRef.current = {
      nodeId: params.nodeId,
      side: params.handleType === "target" ? "input" : "output",
    };
  }, []);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const start = connectionStartRef.current;
    connectionStartRef.current = null;
    if (!start) return;

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".react-flow__handle")) return;

    const point = getClientPoint(event);
    if (!point) return;
    const world = screenToFlowPoint(point.x, point.y);
    setQuickAdd({
      sourceNodeId: start.nodeId,
      sourceSide: start.side,
      clientX: point.x,
      clientY: point.y,
      worldX: world.x,
      worldY: world.y,
    });
  }, [screenToFlowPoint]);

  const handleQuickAdd = useCallback((type: string) => {
    if (!quickAdd) return;
    const node = createNode(type, quickAdd.worldX, quickAdd.worldY, useCanvasStore.getState().nodes);
    addNode(node);
    const sourceId = quickAdd.sourceSide === "output" ? quickAdd.sourceNodeId : node.id;
    const targetId = quickAdd.sourceSide === "output" ? node.id : quickAdd.sourceNodeId;
    if (sourceId !== targetId) {
      addConnection({ id: makeConnectionId(sourceId, targetId), sourceId, targetId });
    }
    selectNode(node.id);
    setQuickAdd(null);
  }, [addConnection, addNode, quickAdd, selectNode]);

  const handleNodeDragStart: OnNodeDrag<TideFlowNode> = useCallback((_event, node) => {
    setDraggingNodeId(node.id);
    useCanvasStore.getState().pushHistory();
  }, []);

  const handleNodeDragStop: OnNodeDrag<TideFlowNode> = useCallback(() => {
    setDraggingNodeId(null);
  }, []);

  const handleEdgeClick: EdgeMouseHandler<TideFlowEdge> = useCallback((event, edge) => {
    event.stopPropagation();
    clearSelection();
    selectConnection(edge.id);
  }, [clearSelection, selectConnection]);

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setQuickAdd(null);
    clearSelection();
    selectConnection(null);
  }, [clearSelection, selectConnection]);

  const handleArrange = useCallback(() => {
    const store = useCanvasStore.getState();
    if (store.nodes.length === 0) return;
    store.pushHistory();
    store.updateNodePositions(autoArrangeNodes(store.nodes, store.connections, store.groups));
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.18, duration: 240 }));
  }, [reactFlow]);

  const handleCreateGroup = useCallback(() => {
    const ids = Array.from(useCanvasStore.getState().selectedNodeIds);
    if (ids.length < 2) {
      toast.info("请先选择至少 2 个节点再成组");
      return;
    }
    const groupId = useCanvasStore.getState().createGroup(ids);
    if (groupId) toast.success("已创建分组");
  }, []);

  const selectedGroupNodeIds = useMemo(() => Array.from(selectedNodeIds), [selectedNodeIds]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleFileDrop = useCallback(async (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDraggingFile(false);

    const files = Array.from(event.dataTransfer.files).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (files.length === 0) {
      if (event.dataTransfer.files.length > 0) toast.error("仅支持拖入图片或视频");
      return;
    }

    const world = screenToFlowPoint(event.clientX, event.clientY);
    toast.info(files.length > 1 ? `正在上传 ${files.length} 个文件...` : "正在上传...");
    let ok = 0;

    await Promise.all(files.map(async (file, index) => {
      const isVideo = file.type.startsWith("video/");
      const previewUrl = URL.createObjectURL(file);
      const store = useCanvasStore.getState();
      const node = createNode(isVideo ? "video" : "image", world.x + index * 48, world.y + index * 48, store.nodes);
      if (isVideo) {
        node.videoSrc = previewUrl;
      } else {
        node.imageSrc = previewUrl;
      }
      node.status = "idle";
      node.uploading = true;
      node.uploadProgress = 0;
      node.fileSize = file.size;
      node.fileType = isVideo ? "video" : "image";
      node.mimeType = file.type;
      if (file.name) node.title = file.name;
      addNode(node);
      selectNode(node.id);

      try {
        const res = await uploadFileSmart(file, (pct) => {
          useCanvasStore.getState().updateNode(node.id, { uploadProgress: pct });
        });
        if (res.success && res.data?.fileUrl) {
          const patch = isVideo
            ? { videoSrc: res.data.fileUrl, status: "success" as const, uploading: false, uploadProgress: 100, fileSize: res.data.fileSize, fileType: res.data.fileType, mimeType: res.data.mimeType }
            : { imageSrc: res.data.fileUrl, status: "success" as const, uploading: false, uploadProgress: 100, fileSize: res.data.fileSize, fileType: res.data.fileType, mimeType: res.data.mimeType };
          useCanvasStore.getState().updateNode(node.id, patch);
          ok++;
        } else {
          const patch = isVideo
            ? { videoSrc: undefined, status: "error" as const, uploading: false, uploadProgress: 0 }
            : { imageSrc: undefined, status: "error" as const, uploading: false, uploadProgress: 0 };
          useCanvasStore.getState().updateNode(node.id, patch);
          toast.error(`上传失败：${res.message || file.name}`);
        }
      } catch (err) {
        const patch = isVideo
          ? { videoSrc: undefined, status: "error" as const, uploading: false, uploadProgress: 0 }
          : { imageSrc: undefined, status: "error" as const, uploading: false, uploadProgress: 0 };
        useCanvasStore.getState().updateNode(node.id, patch);
        toast.error(`上传失败：${(err as Error)?.message || file.name}`);
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    }));

    if (ok > 0) toast.success(ok > 1 ? `已添加 ${ok} 个节点` : "已添加到画布");
  }, [addNode, screenToFlowPoint, selectNode]);

  return (
    <div translate="no" className="notranslate relative h-full w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900">
      <div
        ref={containerRef}
        className="h-full w-full"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
      >
        <ReactFlow<TideFlowNode, TideFlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onSelectionChange={handleSelectionChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={(event) => openContextMenu(event)}
          onNodeContextMenu={(event, node) => openContextMenu(event, node.id)}
          defaultViewport={{ x: initialTransform.x, y: initialTransform.y, zoom: initialTransform.k }}
          minZoom={0.1}
          maxZoom={5}
          snapToGrid={gridSnap}
          snapGrid={SNAP_GRID}
          panOnScroll
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="#d4d4d4" />
          <ViewportPortal>
            <CanvasGroupsLayer groups={groups} nodes={nodes} selectedNodeIds={selectedNodeIds} />
          </ViewportPortal>
          {minimapVisible && (
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeBorderRadius={8}
              nodeColor="#e5e7eb"
              nodeStrokeColor="#9ca3af"
              style={{ marginBottom: 64, marginLeft: 16, borderRadius: 12, overflow: "hidden" }}
            />
          )}
          {selectedGroupNodeIds.length >= 2 && !draggingNodeId && !quickAdd && (
            <NodeToolbar
              nodeId={selectedGroupNodeIds}
              isVisible
              position={Position.Top}
              align="center"
              offset={12}
              style={{ zIndex: 30 }}
            >
              <button
                onClick={handleCreateGroup}
                className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                <Group className="h-3.5 w-3.5" /> 创建分组 <kbd className="ml-0.5 opacity-60">⌘G</kbd>
              </button>
            </NodeToolbar>
          )}
        </ReactFlow>
      </div>

      {nodes.length === 0 && <CanvasEmptyState />}

      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-blue-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/90 px-8 py-6 text-center shadow-xl dark:bg-neutral-900/90">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">释放以上传到画布</p>
            <p className="mt-1 text-xs text-neutral-500">支持图片、视频，自动在落点生成节点</p>
          </div>
        </div>
      )}

      <CanvasQuickAddMenu
        menu={quickAdd}
        onClose={() => setQuickAdd(null)}
        onSelect={handleQuickAdd}
      />

      <CanvasContextMenu
        menu={contextMenu}
        canPaste={clipboard.canPaste}
        canUndo={canUndo}
        canRedo={canRedo}
        selectedCount={selectedNodeIds.size}
        onClose={() => setContextMenu(null)}
        onAddNode={handleAddNode}
        onDeleteNode={removeNode}
        onCopyNode={clipboard.copyNode}
        onCreateGroup={handleCreateGroup}
        onPaste={clipboard.pasteNode}
        onUndo={undo}
        onRedo={redo}
        onUpload={() => alert("上传功能待接入")}
        onSaveAsset={handleSaveAsset}
      />
      <MyAssetsPanel open={myAssetsOpen} onClose={() => setMyAssetsOpen(false)} onPick={addAssetToCanvas} refreshKey={assetsRefreshKey} />
      <CanvasHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} onAddResource={addGeneratedResourceToCanvas} />

      <CanvasAssistantPanel />

      <CanvasBottomToolbar
        zoom={viewport.zoom}
        gridSnap={gridSnap}
        minimapVisible={minimapVisible}
        assetsActive={myAssetsOpen}
        historyActive={historyOpen}
        onAddNode={addNodeAtViewportCenter}
        onZoomIn={() => reactFlow.zoomIn({ duration: 160 })}
        onZoomOut={() => reactFlow.zoomOut({ duration: 160 })}
        onZoomReset={() => reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })}
        onFitView={() => reactFlow.fitView({ padding: 0.18, duration: 240 })}
        onToggleGridSnap={() => setGridSnap((value) => !value)}
        onToggleMinimap={() => setMinimapVisible((value) => !value)}
        onArrange={handleArrange}
        onOpenAssets={() => { setMyAssetsOpen((value) => !value); setHistoryOpen(false); }}
        onOpenHistory={() => { setHistoryOpen((value) => !value); setMyAssetsOpen(false); }}
      />
    </div>
  );
}
