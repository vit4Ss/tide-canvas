"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Clock,
  Frame,
  LayoutGrid,
  Magnet,
  MapPinned,
  PanelLeft,
  Route,
  Check,
  Minus,
  Plus,
  Redo2,
  Undo2,
  Workflow,
  Upload,
  Keyboard,
  Search,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import styles from "./styles/canvas-bottom-toolbar.module.css";

interface Props {
  gridSnap: boolean;
  minimapVisible: boolean;
  connectionsVisible: boolean;
  assetsActive?: boolean;
  historyActive?: boolean;
  onAddNode: (type: string) => void;
  onUpload: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (scale: number) => void;
  onFitView: () => void;
  onToggleGridSnap: () => void;
  onToggleMinimap: () => void;
  onToggleConnections: () => void;
  onArrange: () => void;
  onOpenAssets: () => void;
  onOpenHistory: () => void;
}

export function CanvasBottomToolbar({
  gridSnap,
  minimapVisible,
  connectionsVisible,
  assetsActive,
  historyActive,
  onAddNode,
  onUpload,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFitView,
  onToggleGridSnap,
  onToggleMinimap,
  onToggleConnections,
  onArrange,
  onOpenAssets,
  onOpenHistory,
}: Props) {
  // 自行订阅缩放显示，选择器直接量化成整数百分比：平移不触发，
  // 连续缩放也只在显示值实际变化的帧重渲染
  const zoomPercent = useCanvasViewStore((s) => Math.round(s.transform.k * 100));
  const undoStackLen = useCanvasStore((s) => s.undoStack.length);
  const redoStackLen = useCanvasStore((s) => s.redoStack.length);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const nodeTypes = useCanvasNodeConfigStore((s) => s.nodeTypes);
  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState("");
  const [zoomError, setZoomError] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const zoomWrapperRef = useRef<HTMLDivElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const enabledTypes = nodeTypes.filter((item) => item.enabled && `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim()));

  useEffect(() => {
    if (!addOpen && !helpOpen && !moreOpen && !zoomOpen) return;
    if (addOpen) searchRef.current?.focus();
    if (zoomOpen) {
      zoomInputRef.current?.focus({ preventScroll: true });
      zoomInputRef.current?.select();
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddOpen(false);
      }
      if (!helpRef.current?.contains(event.target as Node)) {
        setHelpOpen(false);
        setMoreOpen(false);
      }
      if (!zoomWrapperRef.current?.contains(event.target as Node)) setZoomOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (zoomOpen) zoomButtonRef.current?.focus({ preventScroll: true });
        else if (addOpen) addButtonRef.current?.focus();
        else if (helpButtonRef.current?.offsetParent) helpButtonRef.current.focus();
        else moreButtonRef.current?.focus();
        setAddOpen(false);
        setHelpOpen(false);
        setMoreOpen(false);
        setZoomOpen(false);
      }
    };

    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addOpen, helpOpen, moreOpen, zoomOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeWhenExpanded = () => {
      if (moreButtonRef.current?.offsetParent === null) {
        setMoreOpen(false);
        helpButtonRef.current?.focus();
      }
    };
    window.addEventListener("resize", closeWhenExpanded);
    return () => window.removeEventListener("resize", closeWhenExpanded);
  }, [moreOpen]);

  const pickNode = (type: string) => {
    onAddNode(type);
    setAddOpen(false);
    setSearch("");
    addButtonRef.current?.focus();
  };

  const applyZoomAction = (action: () => void) => {
    action();
    setZoomOpen(false);
    zoomButtonRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.bottomControls} data-canvas-controls data-popup-open={addOpen || helpOpen || moreOpen || zoomOpen || undefined}>
      <div className={styles.statusBar} aria-label="画布状态与缩放">
        <button
          type="button"
          className={`${styles.assetButton} ${assetsActive ? styles.activeTextButton : ""}`}
          onClick={onOpenAssets}
          title="资产管理"
          aria-label="资产管理"
          aria-pressed={!!assetsActive}
        >
          <PanelLeft className={styles.statusIcon} aria-hidden />
          <span>资产管理</span>
        </button>
        <IconButton className={styles.statusControl} icon={LayoutGrid} label="整理画布" onClick={onArrange} />
        <IconButton className={styles.statusControl} icon={MapPinned} label="小地图" active={minimapVisible} onClick={onToggleMinimap} />
        <IconButton className={styles.statusControl} icon={Route} label={connectionsVisible ? "隐藏节点连线" : "显示节点连线"} active={!connectionsVisible} onClick={onToggleConnections} />
        <IconButton className={styles.statusControl} icon={Magnet} label="网格吸附" active={gridSnap} onClick={onToggleGridSnap} />
        <div ref={zoomWrapperRef} className={styles.zoomCluster} aria-label="画布缩放">
          <button ref={zoomButtonRef} type="button" className={`${styles.zoomPercentButton} ${zoomOpen ? styles.activeTextButton : ""}`} onClick={() => { setZoomOpen((value) => !value); setZoomInput(String(zoomPercent)); setZoomError(false); setAddOpen(false); setHelpOpen(false); setMoreOpen(false); }} title="缩放选项" aria-label={`缩放选项，当前 ${zoomPercent}%`} aria-expanded={zoomOpen} aria-haspopup="dialog">
            {zoomPercent}%
          </button>
          {zoomOpen && <div className={styles.zoomMenu} role="dialog" aria-label="缩放选项">
            <form className={styles.zoomForm} noValidate onSubmit={(event) => {
              event.preventDefault();
              const value = Number(zoomInput);
              if (!zoomInput.trim() || !Number.isFinite(value) || value < 10 || value > 500) { setZoomError(true); return; }
              applyZoomAction(() => onZoomTo(value / 100));
            }}>
              <label htmlFor="canvas-zoom-input">缩放比例</label>
              <div className={styles.zoomInputRow}>
                <div className={styles.zoomInputField}>
                  <input id="canvas-zoom-input" ref={zoomInputRef} type="text" inputMode="decimal" value={zoomInput} aria-invalid={zoomError || undefined} aria-describedby={zoomError ? "canvas-zoom-error" : undefined} onChange={(event) => { setZoomInput(event.target.value); setZoomError(false); }} />
                  <span>%</span>
                </div>
                <button type="submit" className={styles.zoomStepButton} aria-label="应用缩放比例" title="应用缩放比例"><Check className={styles.statusIcon} aria-hidden /></button>
              </div>
              {zoomError && <p id="canvas-zoom-error" role="alert">请输入 10–500 之间的缩放比例</p>}
            </form>
            <MenuAction icon={Plus} label="放大" disabled={zoomPercent >= 500} onClick={() => applyZoomAction(onZoomIn)} />
            <MenuAction icon={Minus} label="缩小" disabled={zoomPercent <= 10} onClick={() => applyZoomAction(onZoomOut)} />
            <MenuAction icon={Frame} label="适合屏幕" onClick={() => applyZoomAction(onFitView)} />
            <div className={styles.zoomPresets}>
              {[50, 100, 200, 500].map((value) => <button key={value} type="button" className={styles.moreMenuItem} onClick={() => applyZoomAction(() => onZoomTo(value / 100))}>
                <span>缩放至 {value}%</span>{zoomPercent === value && <Check className={styles.statusIcon} aria-hidden />}
              </button>)}
            </div>
          </div>}
        </div>
      </div>

      <div className={styles.actionDock} aria-label="画布快捷操作">
        <div ref={addMenuRef} className={styles.addWrapper}>
          <button
            type="button"
            ref={addButtonRef}
            className={`${styles.dockButton} ${addOpen ? styles.activeDockButton : ""}`}
            onClick={() => { setAddOpen((value) => !value); setHelpOpen(false); setMoreOpen(false); setZoomOpen(false); setSearch(""); }}
            title="新增节点"
            aria-label="新增节点"
            aria-expanded={addOpen}
            aria-haspopup="dialog"
          >
            <Plus className={styles.dockIcon} aria-hidden />
          </button>
          {addOpen && (
            <div className={styles.addMenu} role="dialog" aria-label="新增节点">
              <div className={styles.addMenuHeader}>添加到画布</div>
              <label className={styles.searchField}>
                <Search size={15} aria-hidden />
                <input
                  ref={searchRef}
                  aria-label="搜索节点"
                  placeholder="搜索节点…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (enabledTypes.length === 1) pickNode(enabledTypes[0].key);
                    }
                  }}
                />
              </label>
              <div className={styles.menuList}>
              {enabledTypes.map((item) => {
                const Icon = canvasNodeIcon(item.key);
                return (
                  <button key={item.key} type="button" className={styles.addMenuItem} onClick={() => pickNode(item.key)}>
                    <span className={styles.addMenuIcon}><Icon className={styles.menuIcon} aria-hidden /></span>
                    <span className={styles.addMenuText}>
                      <span className={styles.addMenuLabel}>{item.title}</span>
                      <span className={styles.addMenuHint}>{item.description}</span>
                    </span>
                  </button>
                );
              })}
              {enabledTypes.length === 0 && <p className={styles.noResults}>没有匹配的节点，试试其他关键词</p>}
              </div>
            </div>
          )}
        </div>

        <DockButton icon={Upload} label="导入素材" onClick={onUpload} />
        <DockButton className={styles.fullControl} icon={Frame} label="适应视图" onClick={onFitView} />
        <DockButton className={styles.fullControl} icon={Clock} label="历史记录" active={historyActive} onClick={onOpenHistory} />
        <span className={`${styles.divider} ${styles.fullControl}`} />
        <DockButton className={styles.fullControl} icon={Undo2} label="撤销" disabled={undoStackLen === 0} onClick={undo} />
        <DockButton className={styles.fullControl} icon={Redo2} label="重做" disabled={redoStackLen === 0} onClick={redo} />
        <span className={`${styles.divider} ${styles.fullControl}`} />
        <div ref={helpRef} className={styles.addWrapper}>
          <button ref={helpButtonRef} type="button" className={`${styles.dockButton} ${styles.fullControl} ${helpOpen ? styles.activeDockButton : ""}`} title="操作指南与快捷键" aria-label="操作指南与快捷键" aria-expanded={helpOpen} aria-haspopup="dialog" onClick={() => { setHelpOpen((value) => !value); setAddOpen(false); setMoreOpen(false); setZoomOpen(false); }}><Keyboard className={styles.dockIcon} aria-hidden /></button>
          <button ref={moreButtonRef} type="button" className={`${styles.dockButton} ${styles.compactControl} ${moreOpen || helpOpen ? styles.activeDockButton : ""}`} title="更多画布操作" aria-label="更多画布操作" aria-expanded={moreOpen || helpOpen} aria-haspopup="dialog" onClick={() => { setMoreOpen((value) => !value); setAddOpen(false); setHelpOpen(false); setZoomOpen(false); }}><MoreHorizontal className={styles.dockIcon} aria-hidden /></button>
          {moreOpen && <div className={styles.moreMenu} role="dialog" aria-label="更多画布操作">
            <div className={styles.moreZoom} aria-label="画布缩放">
              <span>缩放</span>
              <button type="button" className={styles.zoomStepButton} onClick={onZoomOut} disabled={zoomPercent <= 10} aria-label="缩小画布"><Minus className={styles.statusIcon} aria-hidden /></button>
              <button type="button" className={styles.zoomPercentButton} onClick={() => onZoomTo(1)} title="缩放至 100%">{zoomPercent}%</button>
              <button type="button" className={styles.zoomStepButton} onClick={onZoomIn} disabled={zoomPercent >= 500} aria-label="放大画布"><Plus className={styles.statusIcon} aria-hidden /></button>
            </div>
            {[
              { icon: MapPinned, label: "小地图", active: minimapVisible, onClick: onToggleMinimap },
              { icon: Route, label: "节点连线", active: connectionsVisible, onClick: onToggleConnections },
              { icon: Magnet, label: "网格吸附", active: gridSnap, onClick: onToggleGridSnap },
              { icon: Frame, label: "适应视图", onClick: onFitView },
              { icon: Workflow, label: "自动排布", onClick: onArrange },
              { icon: Clock, label: "历史记录", active: historyActive, onClick: onOpenHistory },
              { icon: Undo2, label: "撤销", disabled: undoStackLen === 0, onClick: undo },
              { icon: Redo2, label: "重做", disabled: redoStackLen === 0, onClick: redo },
              { icon: Keyboard, label: "操作指南与快捷键", onClick: () => setHelpOpen(true) },
            ].map((action) => <MenuAction key={action.label} {...action} onClick={() => { action.onClick(); setMoreOpen(false); moreButtonRef.current?.focus(); }} />)}
          </div>}
          {helpOpen && <div className={styles.helpPanel} role="dialog" aria-label="操作指南与快捷键">
            <div className={styles.helpHeader}><strong>画布操作</strong><button type="button" aria-label="关闭操作指南" onClick={() => { setHelpOpen(false); if (helpButtonRef.current?.offsetParent) helpButtonRef.current.focus(); else moreButtonRef.current?.focus(); }}><X size={16} /></button></div>
            <p>右键空白处添加节点，拖动节点两侧端口建立连接。</p>
            <dl>{[["平移画布", "拖拽空白处 / 双指"], ["缩放画布", "Ctrl / ⌘ + 滚轮"], ["框选节点", "Shift + 拖拽空白处"], ["多选节点", "Shift + 单击"], ["撤销", "Ctrl / ⌘ + Z"], ["重做", "Ctrl / ⌘ + Shift + Z"], ["创建分组", "Ctrl / ⌘ + G"], ["删除选中", "Delete"], ["取消选择", "Esc"]].map(([action, key]) => <div key={action}><dt>{action}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl>
          </div>}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  className = "",
  icon: Icon,
  label,
  active,
  onClick,
}: {
  className?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.statusIconButton} ${className} ${active ? styles.activeIconButton : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
    >
      <Icon className={styles.statusIcon} aria-hidden />
    </button>
  );
}

function DockButton({
  className = "",
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  className?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.dockButton} ${className} ${active ? styles.activeDockButton : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
    >
      <Icon className={styles.dockIcon} aria-hidden />
    </button>
  );
}

function MenuAction({ icon: Icon, label, active, disabled, onClick }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <button type="button" className={styles.moreMenuItem} aria-pressed={active} disabled={disabled} onClick={onClick}>
    <Icon className={styles.dockIcon} aria-hidden />
    <span>{label}</span>
    {active !== undefined && <span className={styles.moreMenuState}>{active ? "已开启" : "已关闭"}</span>}
  </button>;
}
