"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasPanZoom } from "@/hooks/canvas/use-canvas-pan-zoom";
import { useCanvasNodeDrag } from "@/hooks/canvas/use-canvas-node-drag";
import { useCanvasClipboard } from "@/hooks/canvas/use-canvas-clipboard";
import { useCanvasKeyboard } from "@/hooks/canvas/use-canvas-keyboard";
import { useCanvasConnection } from "@/hooks/canvas/use-canvas-connection";
import { useCanvasBoxSelect } from "@/hooks/canvas/use-canvas-box-select";
import { createNode, autoArrangeNodes } from "@/lib/canvas-helpers";
import { CanvasGridBackground } from "./canvas-grid-background";
import { CanvasEmptyState } from "./canvas-empty-state";
import { CanvasNodeComponent } from "./canvas-node";
import { ConnectionsLayer } from "./connections-layer";
import { CanvasSelectionBox } from "./canvas-selection-box";
import { CanvasContextMenu, type ContextMenuState } from "./canvas-context-menu";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { CanvasSideToolbar } from "./canvas-side-toolbar";
import { MyAssetsPanel } from "./my-assets-panel";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { FileType, type FileVO } from "@/types/file";
import { fileApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { CanvasMinimap } from "./canvas-minimap";
import { CanvasQuickAddMenu } from "./canvas-quick-add-menu";

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const selectConnection = useCanvasStore((s) => s.selectConnection);
  const addConnection = useCanvasStore((s) => s.addConnection);
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
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const panZoom = useCanvasPanZoom({ containerRef });
  const nodeDrag = useCanvasNodeDrag({ gridSnap });
  const clipboard = useCanvasClipboard();
  const connection = useCanvasConnection({ containerRef });
  const boxSelect = useCanvasBoxSelect({ containerRef });

  useCanvasKeyboard({ onEscape: () => setContextMenu(null) });

  // 跟踪容器尺寸（供小地图绘制可视区域 + 适应视图计算）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleAddNode = useCallback((type: string, worldX: number, worldY: number) => {
    const node = createNode(type, worldX, worldY, nodes);
    addNode(node);
    selectNode(node.id);
  }, [addNode, selectNode, nodes]);

  // 侧边工具栏「+」：在当前视口中心新建节点
  const addNodeAtViewportCenter = useCallback((type: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const sx = rect ? rect.left + rect.width / 2 : 0;
    const sy = rect ? rect.top + rect.height / 2 : 0;
    const world = panZoom.screenToWorld(sx, sy);
    handleAddNode(type, world.x, world.y);
  }, [panZoom, handleAddNode]);

  // 「我的素材」点选：在视口中心新建图片/视频节点并填入该素材 URL
  const addAssetToCanvas = useCallback((file: FileVO) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const sx = rect ? rect.left + rect.width / 2 : 0;
    const sy = rect ? rect.top + rect.height / 2 : 0;
    const world = panZoom.screenToWorld(sx, sy);
    const type = file.fileType === FileType.VIDEO ? "video" : "image";
    const node = createNode(type, world.x, world.y, nodes);
    if (type === "video") {
      node.videoSrc = file.fileUrl;
    } else {
      node.imageSrc = file.fileUrl;
    }
    node.status = "success";
    addNode(node);
    selectNode(node.id);
  }, [panZoom, nodes, addNode, selectNode]);

  // 右键「保存到我的素材」：把节点图片/视频 URL 记入素材库，并打开/刷新面板
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
      setAssetsRefreshKey((k) => k + 1);
    } else {
      toast.error(res.message || "保存失败");
    }
  }, [nodes, contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    const world = panZoom.screenToWorld(e.clientX, e.clientY);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      worldX: world.x, worldY: world.y,
      type: nodeEl ? "node" : "canvas",
      nodeId: nodeEl?.dataset.nodeId,
    });
  }, [panZoom]);

  // 画布空白处按下：开始平移 OR 框选
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!(target === containerRef.current || target.dataset.canvas)) return;
    if (e.button !== 0) return;

    setContextMenu(null);
    selectConnection(null);
    // Shift 按下时框选，否则平移
    if (e.shiftKey) {
      boxSelect.startBoxSelect(e.clientX, e.clientY);
    } else {
      clearSelection();
      panZoom.handleMouseDown(e);
    }
  }, [boxSelect, clearSelection, panZoom, selectConnection]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    panZoom.handleMouseMove(e);
    nodeDrag.onMove(e);
  }, [panZoom, nodeDrag]);

  const handleMouseUp = useCallback(() => {
    panZoom.handleMouseUp();
    nodeDrag.endDrag();
  }, [panZoom, nodeDrag]);

  const handleArrange = useCallback(() => {
    useCanvasStore.getState().pushHistory();
    autoArrangeNodes(nodes, useCanvasStore.getState().updateNode);
  }, [nodes]);

  const handleConnectionClick = useCallback((id: string) => {
    clearSelection();
    selectConnection(id);
  }, [clearSelection, selectConnection]);

  // 从端口拖线到空白处松手 → 选择类型即新建节点并自动连线
  const handleQuickAdd = useCallback((type: string) => {
    const qa = connection.quickAdd;
    if (!qa) return;
    const node = createNode(type, qa.worldX, qa.worldY, nodes);
    addNode(node);
    const sourceId = qa.sourceSide === "output" ? qa.sourceNodeId : node.id;
    const targetId = qa.sourceSide === "output" ? node.id : qa.sourceNodeId;
    if (sourceId !== targetId) {
      addConnection({ id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, sourceId, targetId });
    }
    selectNode(node.id);
    connection.clearQuickAdd();
  }, [connection, nodes, addNode, addConnection, selectNode]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900">
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        data-canvas="true"
      >
        <CanvasGridBackground transform={panZoom.transform} />

        <div
          style={{
            transform: `translate(${panZoom.transform.x}px, ${panZoom.transform.y}px) scale(${panZoom.transform.k})`,
            transformOrigin: "0 0",
          }}
          className="absolute"
        >
          <ConnectionsLayer
            nodes={nodes}
            connections={connections}
            temp={connection.connecting}
            selectedConnectionId={selectedConnectionId}
            onConnectionClick={handleConnectionClick}
          />
          {nodes.map((node) => (
            <CanvasNodeComponent
              key={node.id}
              node={node}
              isSelected={selectedNodeIds.has(node.id)}
              isDragging={nodeDrag.draggingNodeId === node.id}
              isConnectTarget={connection.hoverTargetNodeId === node.id}
              onNodeMouseDown={nodeDrag.onNodeMouseDown}
              onPortMouseDown={connection.startConnection}
            />
          ))}
          {boxSelect.box && (
            <CanvasSelectionBox
              startWorldX={boxSelect.box.startWorldX}
              startWorldY={boxSelect.box.startWorldY}
              currentWorldX={boxSelect.box.currentWorldX}
              currentWorldY={boxSelect.box.currentWorldY}
            />
          )}
        </div>
      </div>

      {nodes.length === 0 && <CanvasEmptyState />}

      {minimapVisible && (
        <div className="absolute bottom-4 right-4">
          <CanvasMinimap
            nodes={nodes}
            transform={panZoom.transform}
            viewportSize={viewportSize}
            onNavigate={panZoom.centerOn}
          />
        </div>
      )}

      <CanvasQuickAddMenu
        menu={connection.quickAdd}
        onClose={connection.clearQuickAdd}
        onSelect={handleQuickAdd}
      />

      <CanvasContextMenu
        menu={contextMenu}
        canPaste={clipboard.canPaste}
        canUndo={canUndo}
        canRedo={canRedo}
        onClose={() => setContextMenu(null)}
        onAddNode={handleAddNode}
        onDeleteNode={removeNode}
        onCopyNode={clipboard.copyNode}
        onPaste={clipboard.pasteNode}
        onUndo={undo}
        onRedo={redo}
        onUpload={() => alert("上传功能待接入")}
        onSaveAsset={handleSaveAsset}
      />

      <CanvasSideToolbar
        onAddNode={addNodeAtViewportCenter}
        onArrange={handleArrange}
        onOpenAssets={() => { setMyAssetsOpen((v) => !v); setHistoryOpen(false); }}
        assetsActive={myAssetsOpen}
        onOpenHistory={() => { setHistoryOpen((v) => !v); setMyAssetsOpen(false); }}
        historyActive={historyOpen}
      />
      <MyAssetsPanel open={myAssetsOpen} onClose={() => setMyAssetsOpen(false)} onPick={addAssetToCanvas} refreshKey={assetsRefreshKey} />
      <CanvasHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <CanvasBottomToolbar
        zoom={panZoom.transform.k}
        gridSnap={gridSnap}
        minimapVisible={minimapVisible}
        onZoomIn={panZoom.zoomIn}
        onZoomOut={panZoom.zoomOut}
        onZoomReset={panZoom.zoomReset}
        onFitView={panZoom.fitView}
        onToggleGridSnap={() => setGridSnap(!gridSnap)}
        onToggleMinimap={() => setMinimapVisible(!minimapVisible)}
        onArrange={handleArrange}
      />
    </div>
  );
}
