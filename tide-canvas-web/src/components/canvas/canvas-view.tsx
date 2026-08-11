"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";
import { useCanvasClipboard } from "@/hooks/canvas/use-canvas-clipboard";
import { useCanvasKeyboard } from "@/hooks/canvas/use-canvas-keyboard";
import { createNode, autoArrangeNodes } from "@/lib/canvas-helpers";
import { requestCanvasSave } from "@/lib/canvas-save";
import { CanvasEmptyState } from "./canvas-empty-state";
import { CanvasGroupsLayer } from "./canvas-groups-layer";
import { CanvasContextMenu, type ContextMenuState } from "./canvas-context-menu";
import { CanvasBottomToolbar } from "./canvas-bottom-toolbar";
import { MyAssetsPanel } from "./my-assets-panel";
import { CanvasHistoryPanel } from "./canvas-history-panel";
import { toast } from "@/components/shared/toast";
import { CanvasQuickAddMenu } from "./canvas-quick-add-menu";
import { CanvasAssistantPanel } from "./canvas-assistant-panel";
import { CanvasQuickStart } from "./canvas-quick-start";
import type { CanvasLaunchJournal } from "@/lib/canvas-launch";
// 画布内部分节点(image-node / quality-ratio-dropdown)使用 @mantine/core,需 Provider + 其 CSS。
// 就近包在画布视图内,避免改动画布入口路由。
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@xyflow/react/dist/style.css";
import type {
  CanvasFlowEdge,
  CanvasFlowNode,
} from "@/features/canvas/infrastructure/react-flow/canvas-flow-types";
import type { MediaAssetVO } from "@/types/media-asset";
import { CanvasFlowNodeView } from "@/features/canvas/presentation/flow/canvas-flow-node";
import { CanvasFlowEdgeView } from "@/features/canvas/presentation/flow/canvas-flow-edge";
import { useCanvasFlowController } from "@/features/canvas/presentation/flow/use-canvas-flow-controller";
import { useCanvasMediaTransfer } from "@/features/canvas/application/media/use-canvas-media-transfer";
import { placeHistoryAssets } from "@/features/canvas/application/history/history-node-placement";
import { getCanvasSelectionAnchor } from "@/features/canvas/application/selection/canvas-selection";
import { CanvasGroupCreateButton } from "@/features/canvas/presentation/groups/canvas-group-create-button";
import flowStyles from "@/features/canvas/presentation/flow/canvas-flow.module.css";

interface CanvasViewProps {
  launchJournal?: CanvasLaunchJournal | null;
  persistenceReady?: boolean;
  onLaunchConsumed?: () => void;
}

const FLOW_NODE_TYPES: NodeTypes = { canvasNode: CanvasFlowNodeView };
const FLOW_EDGE_TYPES: EdgeTypes = { canvasEdge: CanvasFlowEdgeView };
const HIDE_REACT_FLOW_ATTRIBUTION = process.env.NEXT_PUBLIC_REACT_FLOW_PRO === "true";
// React Flow 默认仅容忍 1px 位移；触控板和高 DPI 鼠标的自然抖动会被误判为画布拖动。
const PANE_CLICK_DISTANCE_PX = 6;
const MINI_MAP_COLORS: Record<string, string> = {
  character: "#60a5fa",
  scene: "#2dd4bf",
  text: "#22d3ee",
  image: "#34d399",
  video: "#fb923c",
  video_compose: "#f472b6",
  scene_3d: "#a78bfa",
  audio: "#c084fc",
  script: "#94a3b8",
};

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasViewContent {...props} />
    </ReactFlowProvider>
  );
}

function CanvasViewContent({ launchJournal, persistenceReady = false, onLaunchConsumed }: CanvasViewProps) {
  // A journal that already froze/submitted the legacy single-model payload
  // must resume that exact request. Fresh journals with a selected Skill are
  // handed to the assistant only when the user asked to run immediately.
  // Canvas mode off keeps its explicit promise: materialize an idle node.
  const resumeDirectLaunch = !!launchJournal && (
    !launchJournal.selectedSkill ||
    !launchJournal.canvasMode ||
    !!launchJournal.generationPayload ||
    !!launchJournal.taskId
  );
  const assistantLaunchJournal = launchJournal && !resumeDirectLaunch ? launchJournal : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canUndo = useCanvasStore((s) => s.undoStack.length > 0);
  const canRedo = useCanvasStore((s) => s.redoStack.length > 0);
  const loadNodeConfig = useCanvasNodeConfigStore((s) => s.load);

  const [gridSnap, setGridSnap] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // 容器在屏幕中的原点（用于把世界坐标换算成 fixed 屏幕坐标；在 effect 里更新，避免 render 读 ref）
  const [containerOrigin, setContainerOrigin] = useState({ left: 0, top: 0 });

  const reactFlow = useReactFlow<CanvasFlowNode, CanvasFlowEdge>();
  const clipboard = useCanvasClipboard();

  useCanvasKeyboard({ onEscape: () => setContextMenu(null) });

  // 节点能力属于平台配置，不写入 canvas_data/undo。画布只加载一份；回到页面
  // 时强制重验，后台刚保存的开关无需刷新整个项目即可生效。
  useEffect(() => {
    void loadNodeConfig(true);
    const refresh = () => void loadNodeConfig(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadNodeConfig]);

  // 跟踪容器原点，供世界坐标上的浮动操作换算为 fixed 屏幕坐标。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
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

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    return reactFlow.screenToFlowPosition({ x: clientX, y: clientY });
  }, [reactFlow]);

  const closeTransientUi = useCallback(() => setContextMenu(null), []);
  const mediaContextTarget = useMemo(() => contextMenu ? {
    x: contextMenu.worldX,
    y: contextMenu.worldY,
    nodeId: contextMenu.nodeId,
  } : null, [contextMenu]);
  const {
    assetsOpen,
    setAssetsOpen,
    assetsRefreshKey,
    isDraggingFile,
    uploadInputRef,
    addAssetToCanvas,
    saveContextAsset,
    handleDragOver,
    handleDragLeave,
    handleFileDrop,
    requestUpload,
    handleUploadPick,
  } = useCanvasMediaTransfer({
    containerRef,
    contextTarget: mediaContextTarget,
    screenToWorld,
  });
  const flow = useCanvasFlowController({
    containerRef,
    nodes,
    connections,
    selectedNodeIds,
    selectedConnectionId,
    screenToWorld,
    closeTransientUi,
  });

  const getViewportCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const sx = rect ? rect.left + rect.width / 2 : 0;
    const sy = rect ? rect.top + rect.height / 2 : 0;
    return screenToWorld(sx, sy);
  }, [screenToWorld]);

  // 侧边工具栏「+」：在当前视口中心新建节点
  const addNodeAtViewportCenter = useCallback((type: string) => {
    const world = getViewportCenter();
    handleAddNode(type, world.x, world.y);
  }, [getViewportCenter, handleAddNode]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    const world = screenToWorld(e.clientX, e.clientY);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      worldX: world.x, worldY: world.y,
      type: nodeEl ? "node" : "canvas",
      nodeId: nodeEl?.dataset.nodeId,
    });
  }, [screenToWorld]);

  const handleArrange = useCallback(() => {
    const st = useCanvasStore.getState();
    if (st.nodes.length === 0) return;
    st.pushHistory();
    // 纯函数算位 → 单次批量落位（一次渲染），随后视口适配新布局
    st.updateNodePositions(autoArrangeNodes(st.nodes, st.connections, st.groups));
    requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.12, maxZoom: 1.5, duration: 160 });
    });
  }, [reactFlow]);

  // 把当前多选节点创建为一个分组
  const handleCreateGroup = useCallback(() => {
    const ids = Array.from(useCanvasStore.getState().selectedNodeIds);
    if (ids.length < 2) { toast.info("请先选择至少 2 个节点再成组"); return; }
    const gid = useCanvasStore.getState().createGroup(ids);
    if (gid) toast.success("已创建分组");
  }, []);

  const selectionAnchor = useMemo(
    () => getCanvasSelectionAnchor(nodes, selectedNodeIds),
    [nodes, selectedNodeIds],
  );

  const zoomIn = useCallback(() => { void reactFlow.zoomIn({ duration: 120 }); }, [reactFlow]);
  const zoomOut = useCallback(() => { void reactFlow.zoomOut({ duration: 120 }); }, [reactFlow]);
  const zoomReset = useCallback(() => {
    void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 160 });
  }, [reactFlow]);
  const fitView = useCallback(() => {
    void reactFlow.fitView({ padding: 0.12, maxZoom: 1.5, duration: 160 });
  }, [reactFlow]);

  const handleUseHistoryAssets = useCallback(async (assets: MediaAssetVO[]) => {
    const snapshot = useCanvasStore.getState();
    const placement = placeHistoryAssets(assets, snapshot.nodes, getViewportCenter());
    if (placement.nodes.length === 0) return;

    // One store transaction = one undo step. Passing no selection id preserves
    // the user's explicit choice not to auto-select restored history nodes.
    snapshot.addNodesAndConnections(placement.nodes, [], undefined);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void reactFlow.fitView({
          nodes: placement.nodes.map((node) => ({ id: node.id })),
          padding: placement.nodes.length === 1 ? 0.24 : 0.16,
          minZoom: 0.12,
          maxZoom: 1.15,
          duration: 200,
        });
      });
    });

    const currentProjectId = useCanvasStore.getState().currentProjectId;
    if (currentProjectId) {
      const saved = await requestCanvasSave(currentProjectId);
      if (!saved) toast.info("节点已添加，画布将在连接恢复后自动保存");
    }
    toast.success(placement.nodes.length > 1 ? `已添加 ${placement.nodes.length} 个节点` : "已添加到画布");
  }, [getViewportCenter, reactFlow]);

  const miniMapNodeColor = useCallback((node: CanvasFlowNode) => {
    return MINI_MAP_COLORS[node.data.node.type] || "#a1a1aa";
  }, []);

  return (
    // translate="no" + notranslate：告知浏览器/翻译类扩展（如「沉浸式翻译」）整块画布勿翻译，
    // 抑制其在节点（尤其视频）上注入的悬浮翻译工具条。彻底关闭仍需在扩展侧将本站设为「永不翻译」。
    <MantineProvider>
    <div translate="no" className="notranslate relative h-full w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900">
      <div
        ref={containerRef}
        className={`${flowStyles.root} h-full w-full`}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
        data-canvas="true"
      >
        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          nodes={flow.flowNodes}
          edges={flow.flowEdges}
          nodeTypes={FLOW_NODE_TYPES}
          edgeTypes={FLOW_EDGE_TYPES}
          onNodesChange={flow.handleNodesChange}
          onEdgesChange={flow.handleEdgesChange}
          onNodeDragStart={flow.handleNodeDragStart}
          onNodeDragStop={flow.handleNodeDragStop}
          nodeDragThreshold={4}
          paneClickDistance={PANE_CLICK_DISTANCE_PX}
          onConnect={flow.handleConnect}
          onConnectEnd={flow.handleConnectEnd}
          onPaneClick={flow.handlePaneClick}
          onMove={flow.handleMove}
          onInit={flow.handleInit}
          minZoom={0.1}
          maxZoom={5}
          snapToGrid={gridSnap}
          snapGrid={[20, 20]}
          panOnDrag={[0, 1]}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Meta", "Control"]}
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={null}
          connectionRadius={28}
          connectOnClick
          preventScrolling
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: HIDE_REACT_FLOW_ATTRIBUTION }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={2}
            color="var(--canvas-grid-color)"
          />
          <ViewportPortal>
            <CanvasGroupsLayer groups={groups} nodes={nodes} selectedNodeIds={selectedNodeIds} />
          </ViewportPortal>
          {minimapVisible && (
            <MiniMap
              position="bottom-left"
              nodeColor={miniMapNodeColor}
              pannable
              zoomable
              style={{ width: 200, height: 140, left: 16, bottom: 64 }}
              maskColor="rgb(59 130 246 / 0.08)"
            />
          )}
        </ReactFlow>
      </div>

      {launchJournal && resumeDirectLaunch && (
        <CanvasQuickStart
          variant="consumer"
          getViewportCenter={getViewportCenter}
          launchJournal={launchJournal}
          persistenceReady={persistenceReady}
          onLaunchConsumed={onLaunchConsumed}
        />
      )}

      {nodes.length === 0 && <CanvasEmptyState />}

      {/* 多选浮动操作：在选区顶部上方居中显示「创建分组」（拖动/框选/连线时隐藏） */}
      {selectionAnchor && !flow.isNodeDragging && (
        <CanvasGroupCreateButton
          anchor={selectionAnchor}
          containerOrigin={containerOrigin}
          onClick={handleCreateGroup}
        />
      )}

      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-blue-500/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/90 px-8 py-6 text-center shadow-xl dark:bg-neutral-900/90">
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">释放以上传到画布</p>
            <p className="mt-1 text-xs text-neutral-500">支持图片、视频，自动在落点生成节点</p>
          </div>
        </div>
      )}

      <CanvasQuickAddMenu
        menu={flow.quickAdd}
        onClose={() => flow.setQuickAdd(null)}
        onSelect={flow.handleQuickAdd}
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
        onUpload={requestUpload}
        onOpenHistory={() => { setHistoryOpen(true); setAssetsOpen(false); }}
        onSaveAsset={saveContextAsset}
      />
      {/* 右键「上传」的隐藏文件选择器；与拖拽上传共用 uploadFilesAt 链路 */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleUploadPick}
      />
      <MyAssetsPanel
        open={assetsOpen}
        onClose={() => setAssetsOpen(false)}
        onPick={addAssetToCanvas}
        refreshKey={assetsRefreshKey}
      />
      <CanvasHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onUse={handleUseHistoryAssets}
      />

      <CanvasAssistantPanel
        launchJournal={assistantLaunchJournal}
        persistenceReady={persistenceReady}
        onLaunchConsumed={onLaunchConsumed}
      />

      <CanvasBottomToolbar
        gridSnap={gridSnap}
        minimapVisible={minimapVisible}
        assetsActive={assetsOpen}
        historyActive={historyOpen}
        onAddNode={addNodeAtViewportCenter}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onFitView={fitView}
        onToggleGridSnap={() => setGridSnap(!gridSnap)}
        onToggleMinimap={() => setMinimapVisible(!minimapVisible)}
        onArrange={handleArrange}
        onOpenAssets={() => { setAssetsOpen((value) => !value); setHistoryOpen(false); }}
        onOpenHistory={() => { setHistoryOpen((value) => !value); setAssetsOpen(false); }}
      />
    </div>
    </MantineProvider>
  );
}
