"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Clock,
  Frame,
  LayoutGrid,
  Magnet,
  Map,
  Minus,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import styles from "./styles/canvas-bottom-toolbar.module.css";

interface Props {
  gridSnap: boolean;
  minimapVisible: boolean;
  assetsActive?: boolean;
  historyActive?: boolean;
  onAddNode: (type: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitView: () => void;
  onToggleGridSnap: () => void;
  onToggleMinimap: () => void;
  onArrange: () => void;
  onOpenAssets: () => void;
  onOpenHistory: () => void;
  onRunSkill: () => void;
}

export function CanvasBottomToolbar({
  gridSnap,
  minimapVisible,
  assetsActive,
  historyActive,
  onAddNode,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitView,
  onToggleGridSnap,
  onToggleMinimap,
  onArrange,
  onOpenAssets,
  onOpenHistory,
  onRunSkill,
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
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };

    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addOpen]);

  const pickNode = (type: string) => {
    onAddNode(type);
    setAddOpen(false);
  };

  return (
    <>
      <div className={styles.statusBar} aria-label="画布状态与缩放">
        <button
          type="button"
          className={`${styles.assetButton} ${assetsActive ? styles.activeTextButton : ""}`}
          onClick={onOpenAssets}
          title="资产管理"
          aria-pressed={!!assetsActive}
        >
          <LayoutGrid className={styles.statusIcon} aria-hidden />
          <span>资产管理</span>
        </button>
        <IconButton icon={Map} label="小地图" active={minimapVisible} onClick={onToggleMinimap} />
        <IconButton icon={Magnet} label="网格吸附" active={gridSnap} onClick={onToggleGridSnap} />
        <div className={styles.zoomCluster} aria-label="画布缩放">
          <button type="button" className={styles.zoomStepButton} onClick={onZoomOut} disabled={zoomPercent <= 10} title="缩小画布">
            <Minus className={styles.statusIcon} aria-hidden />
          </button>
          <button type="button" className={styles.zoomPercentButton} onClick={onZoomReset} title="重置为 100%">
            {zoomPercent}%
          </button>
          <button type="button" className={styles.zoomStepButton} onClick={onZoomIn} disabled={zoomPercent >= 500} title="放大画布">
            <Plus className={styles.statusIcon} aria-hidden />
          </button>
        </div>
      </div>

      <div className={styles.actionDock} aria-label="画布快捷操作">
        <div ref={addMenuRef} className={styles.addWrapper}>
          <button
            type="button"
            className={`${styles.dockButton} ${styles.primaryDockButton}`}
            onClick={() => setAddOpen((value) => !value)}
            title="新增节点"
            aria-label="新增节点"
            aria-expanded={addOpen}
            aria-haspopup="menu"
          >
            <Plus className={styles.dockIcon} aria-hidden />
          </button>
          {addOpen && (
            <div className={styles.addMenu} role="menu">
              <div className={styles.addMenuHeader}>新增节点</div>
              {nodeTypes.filter((item) => item.enabled).map((item) => {
                const Icon = canvasNodeIcon(item.key);
                return (
                  <button key={item.key} type="button" className={styles.addMenuItem} onClick={() => pickNode(item.key)} role="menuitem">
                    <span className={styles.addMenuIcon}><Icon className={styles.menuIcon} aria-hidden /></span>
                    <span className={styles.addMenuText}>
                      <span className={styles.addMenuLabel}>{item.title}</span>
                      <span className={styles.addMenuHint}>{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DockButton icon={Sparkles} label="运行 Skill" onClick={onRunSkill} />
        <DockButton icon={Workflow} label="自动排布" onClick={onArrange} />
        <DockButton icon={Frame} label="适应视图" onClick={onFitView} />
        <DockButton icon={Clock} label="历史记录" active={historyActive} onClick={onOpenHistory} />
        <span className={styles.divider} />
        <DockButton icon={Undo2} label="撤销" disabled={undoStackLen === 0} onClick={undo} />
        <DockButton icon={Redo2} label="重做" disabled={redoStackLen === 0} onClick={redo} />
      </div>
    </>
  );
}

function IconButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.statusIconButton} ${active ? styles.activeIconButton : ""}`}
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
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.dockButton} ${active ? styles.activeDockButton : ""}`}
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
