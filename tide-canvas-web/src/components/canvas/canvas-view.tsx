"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Group } from "lucide-react";
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
import { CanvasGroupsLayer } from "./canvas-groups-layer";
import { CanvasSelectionBox } from "./canvas-selection-box";
import { CanvasContextMenu, type ContextMenuState } from "./canvas-context-menu";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { CanvasSideToolbar } from "./canvas-side-toolbar";
import { MyAssetsPanel } from "./my-assets-panel";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { FileType, type FileVO } from "@/types/file";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { CanvasMinimap } from "./canvas-minimap";
import { CanvasQuickAddMenu } from "./canvas-quick-add-menu";

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
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
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // 容器在屏幕中的原点（用于把世界坐标换算成 fixed 屏幕坐标；在 effect 里更新，避免 render 读 ref）
  const [containerOrigin, setContainerOrigin] = useState({ left: 0, top: 0 });

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
    const update = () => {
      const r = el.getBoundingClientRect();
      setViewportSize({ width: r.width, height: r.height });
      setContainerOrigin({ left: r.left, top: r.top });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("scroll", update, true);
    return () => { ro.disconnect(); window.removeEventListener("scroll", update, true); };
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
    const st = useCanvasStore.getState();
    if (st.nodes.length === 0) return;
    st.pushHistory();
    // 纯函数算位 → 单次批量落位（一次渲染），随后视口适配新布局
    st.updateNodePositions(autoArrangeNodes(st.nodes, st.connections, st.groups));
    panZoom.fitView();
  }, [panZoom]);

  // 把当前多选节点创建为一个分组
  const handleCreateGroup = useCallback(() => {
    const ids = Array.from(useCanvasStore.getState().selectedNodeIds);
    if (ids.length < 2) { toast.info("请先选择至少 2 个节点再成组"); return; }
    const gid = useCanvasStore.getState().createGroup(ids);
    if (gid) toast.success("已创建分组");
  }, []);

  // 多选时（≥2）计算包围盒顶部中点 → 供浮动「创建分组」按钮定位
  const selectionBox = useMemo(() => {
    if (selectedNodeIds.size < 2) return null;
    const sel = nodes.filter((n) => selectedNodeIds.has(n.id));
    if (sel.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const n of sel) {
      const w = n.contentW ?? n.width;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + w > maxX) maxX = n.x + w;
    }
    return { cx: (minX + maxX) / 2, top: minY };
  }, [nodes, selectedNodeIds]);

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

  // 从系统拖入文件到画布：上传图片/视频，并在落点生成对应节点（多文件错开排列）
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 仅在真正离开画布容器（而非进入子元素）时取消高亮
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFile(false);
    }
  }, []);

  // 上传一批图片/视频并在给定世界坐标处逐个落节点（拖入与「上传」菜单共用）。
  const placeFilesAt = useCallback(async (files: File[], world: { x: number; y: number }) => {
    if (files.length === 0) return;
    // 超过 100MB(与网关 proxyClientMaxBodySize 一致)的文件先行拦截,避免白传后服务端才失败。
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
    files = files.filter((f) => f.size <= MAX_FILE_SIZE);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} 个文件超过 100MB，已跳过`);
    }
    if (files.length === 0) return;
    toast.info(files.length > 1 ? `正在上传 ${files.length} 个文件…` : "正在上传…");
    let ok = 0;
    await Promise.all(
      files.map(async (file, i) => {
        const isVideo = file.type.startsWith("video/");
        try {
          const res = await uploadFileSmart(file);
          if (res.success && res.data?.fileUrl) {
            const node = createNode(isVideo ? "video" : "image", world.x + i * 48, world.y + i * 48, useCanvasStore.getState().nodes);
            if (isVideo) node.videoSrc = res.data.fileUrl;
            else node.imageSrc = res.data.fileUrl;
            node.status = "success";
            if (file.name) node.title = file.name;
            addNode(node);
            ok++;
          } else {
            toast.error(`上传失败：${res.message || file.name}`);
          }
        } catch (err) {
          toast.error(`上传失败：${(err as Error)?.message || file.name}`);
        }
      })
    );
    if (ok > 0) toast.success(ok > 1 ? `已添加 ${ok} 个节点` : "已添加到画布");
  }, [addNode]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (files.length === 0) {
      if (e.dataTransfer.files.length > 0) toast.error("仅支持拖入图片或视频");
      return;
    }
    const world = panZoom.screenToWorld(e.clientX, e.clientY);
    await placeFilesAt(files, world);
  }, [panZoom, placeFilesAt]);

  // 右键菜单「上传」：记录落点后打开文件选择框（选择是异步的，位置先存 ref）。
  const uploadWorldRef = useRef<{ x: number; y: number } | null>(null);
  const handleUpload = useCallback(() => {
    // 右键菜单调用 onUpload 前会先 onClose()，但 contextMenu 闭包在本次同步事件中仍是旧值；
    // 取不到时回退到视口中心。
    if (contextMenu) {
      uploadWorldRef.current = { x: contextMenu.worldX, y: contextMenu.worldY };
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = rect ? rect.left + rect.width / 2 : 0;
      const sy = rect ? rect.top + rect.height / 2 : 0;
      uploadWorldRef.current = panZoom.screenToWorld(sx, sy);
    }
    fileInputRef.current?.click();
  }, [contextMenu, panZoom]);

  const handleUploadInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    e.target.value = ""; // 允许再次选择同一文件
    if (picked.length === 0) {
      toast.error("仅支持图片或视频");
      return;
    }
    // 正常路径 uploadWorldRef 已在打开选择框前写入；兜底用视口中心（非屏幕原点）。
    let world = uploadWorldRef.current;
    if (!world) {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = rect ? rect.left + rect.width / 2 : 0;
      const sy = rect ? rect.top + rect.height / 2 : 0;
      world = panZoom.screenToWorld(sx, sy);
    }
    await placeFilesAt(picked, world);
  }, [panZoom, placeFilesAt]);

  return (
    // translate="no" + notranslate：告知浏览器/翻译类扩展（如「沉浸式翻译」）整块画布勿翻译，
    // 抑制其在节点（尤其视频）上注入的悬浮翻译工具条。彻底关闭仍需在扩展侧将本站设为「永不翻译」。
    <div translate="no" className="notranslate relative h-full w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900">
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
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
          <CanvasGroupsLayer groups={groups} nodes={nodes} selectedNodeIds={selectedNodeIds} />
          <ConnectionsLayer
            nodes={nodes}
            connections={connections}
            temp={connection.connecting}
            selectedConnectionId={selectedConnectionId}
            selectedNodeIds={selectedNodeIds}
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

      {/* 多选浮动操作：在选区顶部上方居中显示「创建分组」（拖动/框选/连线时隐藏） */}
      {selectionBox && !nodeDrag.draggingNodeId && !boxSelect.isBoxSelecting && !connection.connecting && (
        <button
          onClick={handleCreateGroup}
          style={{
            left: containerOrigin.left + panZoom.transform.x + selectionBox.cx * panZoom.transform.k,
            top: containerOrigin.top + panZoom.transform.y + selectionBox.top * panZoom.transform.k - 12,
          }}
          className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Group className="h-3.5 w-3.5" /> 创建分组 <kbd className="ml-0.5 opacity-60">⌘G</kbd>
        </button>
      )}

      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-blue-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/90 px-8 py-6 text-center shadow-xl dark:bg-neutral-900/90">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">释放以上传到画布</p>
            <p className="mt-1 text-xs text-neutral-500">支持图片、视频，自动在落点生成节点</p>
          </div>
        </div>
      )}

      {minimapVisible && (
        <div className="absolute bottom-16 left-4">
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
        selectedCount={selectedNodeIds.size}
        onClose={() => setContextMenu(null)}
        onAddNode={handleAddNode}
        onDeleteNode={removeNode}
        onCopyNode={clipboard.copyNode}
        onCreateGroup={handleCreateGroup}
        onPaste={clipboard.pasteNode}
        onUndo={undo}
        onRedo={redo}
        onUpload={handleUpload}
        onSaveAsset={handleSaveAsset}
      />

      {/* 隐藏文件选择框：右键菜单「上传」触发，支持多选图片/视频 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={handleUploadInputChange}
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
