"use client";

import { useCallback, useRef, useState, type ComponentType } from "react";
import {
  AlignLeft,
  AudioLines,
  Clapperboard,
  Clock,
  Frame,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Magnet,
  Map,
  Minus,
  Plus,
  Redo2,
  Undo2,
  Video,
  Workflow,
} from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import styles from "./styles/canvas-bottom-toolbar.module.css";
import { useDismissibleCanvasOverlay, useExclusiveCanvasOverlay } from "./canvas-overlay-coordinator";

interface Props {
  zoom: number;
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
}

interface NodeTypeAction {
  type: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

// 中文注释：底部新增节点菜单复用画布已有节点类型，避免侧边工具条与底部工具坞重复维护。
const NODE_TYPES: NodeTypeAction[] = [
  { type: "image", label: "图片", hint: "图像生成、参考图编辑", icon: ImageIcon },
  { type: "video", label: "视频", hint: "视频生成、镜头创作", icon: Video },
  { type: "text", label: "文本", hint: "提示词、脚本说明", icon: AlignLeft },
  { type: "audio", label: "音频", hint: "音色、配乐与旁白", icon: AudioLines },
  { type: "scene_3d", label: "导演台", hint: "角色动作与空间编排", icon: Layers },
  { type: "script", label: "脚本", hint: "分镜和内容结构", icon: Clapperboard },
];

export function CanvasBottomToolbar({
  zoom,
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
}: Props) {
  const undoStackLen = useCanvasStore((s) => s.undoStack.length);
  const redoStackLen = useCanvasStore((s) => s.redoStack.length);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const [addOpen, setAddOpen] = useState(false);
  const closeAddMenu = useCallback(() => setAddOpen(false), []);
  const announceAddOpen = useExclusiveCanvasOverlay(addOpen, closeAddMenu, "canvas-add-menu");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const zoomPercent = Math.round(zoom * 100);
  useDismissibleCanvasOverlay(addOpen, closeAddMenu, [addMenuRef]);

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
        >
          <LayoutGrid className={styles.statusIcon} />
          <span>资产管理</span>
        </button>
        <IconButton icon={Map} label="小地图" active={minimapVisible} onClick={onToggleMinimap} />
        <IconButton icon={Magnet} label="网格吸附" active={gridSnap} onClick={onToggleGridSnap} />
        <div className={styles.zoomCluster} aria-label="画布缩放">
          <button type="button" className={styles.zoomStepButton} onClick={onZoomOut} disabled={zoom <= 0.1} title="缩小画布">
            <Minus className={styles.statusIcon} />
          </button>
          <button type="button" className={styles.zoomPercentButton} onClick={onZoomReset} title="重置为 100%">
            {zoomPercent}%
          </button>
          <button type="button" className={styles.zoomStepButton} onClick={onZoomIn} disabled={zoom >= 5} title="放大画布">
            <Plus className={styles.statusIcon} />
          </button>
        </div>
      </div>

      <div className={styles.actionDock} aria-label="画布快捷操作">
        <div ref={addMenuRef} className={styles.addWrapper}>
          <button
            type="button"
            className={`${styles.dockButton} ${styles.primaryDockButton}`}
            onClick={() => {
              if (!addOpen) announceAddOpen();
              setAddOpen((value) => !value);
            }}
            title="新增节点"
            aria-expanded={addOpen}
          >
            <Plus className={styles.dockIcon} />
          </button>
          {addOpen && (
            <div className={styles.addMenu} role="menu">
              <div className={styles.addMenuHeader}>新增节点</div>
              {NODE_TYPES.map((item) => (
                <button key={item.type} type="button" className={styles.addMenuItem} onClick={() => pickNode(item.type)} role="menuitem">
                  <span className={styles.addMenuIcon}><item.icon className={styles.menuIcon} /></span>
                  <span className={styles.addMenuText}>
                    <span className={styles.addMenuLabel}>{item.label}</span>
                    <span className={styles.addMenuHint}>{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <DockButton icon={Workflow} label="自动排布" onClick={onArrange} />
        <DockButton icon={Frame} label="适应视图" onClick={onFitView} />
        <DockButton icon={Clock} label="资源历史" active={historyActive} onClick={onOpenHistory} />
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
    <button type="button" className={`${styles.statusIconButton} ${active ? styles.activeIconButton : ""}`} onClick={onClick} title={label}>
      <Icon className={styles.statusIcon} />
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
    >
      <Icon className={styles.dockIcon} />
    </button>
  );
}
