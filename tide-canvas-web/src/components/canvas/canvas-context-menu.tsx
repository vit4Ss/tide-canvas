"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Upload as UploadIcon, History, ChevronLeft, ChevronRight,
  Trash2, Copy, Group, Bookmark, Plus, Undo2, Redo2, Clipboard,
} from "lucide-react";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import { resolveContextMenuLayout } from "@/lib/canvas-context-menu-layout";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";
import styles from "./styles/canvas-context-menu.module.css";

export interface ContextMenuState {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  type: "canvas" | "node";
  nodeId?: string;
}

const RESOURCE_TYPES = [
  { type: "upload", label: "上传", desc: "从本地上传文件", icon: UploadIcon },
  { type: "history", label: "从生成历史选择", desc: "复用历史生成结果", icon: History },
];

interface Props {
  menu: ContextMenuState | null;
  canUndo?: boolean;
  canRedo?: boolean;
  canPaste?: boolean;
  selectedCount?: number;
  onClose: () => void;
  onAddNode: (type: string, worldX: number, worldY: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onCopyNode: (nodeId: string) => void;
  onCreateGroup?: () => void;
  onUpload?: () => void;
  onOpenHistory?: () => void;
  onSaveAsset?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: (worldX: number, worldY: number) => void;
}

export function CanvasContextMenu({
  menu, canUndo = false, canRedo = false, canPaste = false, selectedCount = 0,
  onClose, onAddNode, onDeleteNode, onCopyNode, onCreateGroup,
  onUpload, onOpenHistory, onSaveAsset, onUndo, onRedo, onPaste,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastView = useRef<"main" | "nodes">("main");
  const keyboardNavigationRef = useRef(false);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const nodeTypes = useCanvasNodeConfigStore((state) => state.nodeTypes);
  const enabledNodeTypes = nodeTypes.filter((item) => item.enabled);
  const [view, setView] = useState<"main" | "nodes">("main");
  const [prevMenu, setPrevMenu] = useState(menu);
  if (menu !== prevMenu) {
    setPrevMenu(menu);
    setView("main");
    setKeyboardNavigation(false);
  }

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu, onClose]);

  // Preserve the opening position between views. Longer content scrolls inside
  // that anchor; only a real viewport resize can move the menu again.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    keyboardNavigationRef.current = false;
    element.style.maxHeight = "";
    let previous: { left: number; top: number } | undefined;
    const position = () => {
      const layout = resolveContextMenuLayout({
        anchor: menu,
        menu: { width: element.offsetWidth, height: element.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        previous,
      });
      previous = layout;
      element.style.left = `${layout.left}px`;
      element.style.top = `${layout.top}px`;
      element.style.maxHeight = `${layout.maxHeight}px`;
      element.style.visibility = "visible";
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu) return;
    if (listRef.current) listRef.current.scrollTop = 0;
    const selector = view === "main" && lastView.current === "nodes"
      ? "[data-add-node]" : "button:not(:disabled)";
    // Pointer interaction focuses the menu itself, without selecting an action.
    // Keyboard drill-in starts at the first node; going back restores its trigger.
    const target = !keyboardNavigationRef.current ? menuRef.current
      : view === "nodes" ? listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menuRef.current
        : menuRef.current?.querySelector<HTMLButtonElement>(selector)
          ?? menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus({ preventScroll: true });
    lastView.current = view;
  }, [menu, view]);

  if (!menu) return null;

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = (key: string, shift = false) => isMac
    ? `⌘${shift ? "⇧" : ""}${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
  const handleAddNode = (type: string) => {
    onAddNode(type, menu.worldX, menu.worldY);
    onClose();
  };
  const setNavigationMode = (keyboard: boolean) => {
    keyboardNavigationRef.current = keyboard;
    setKeyboardNavigation(keyboard);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) {
      setNavigationMode(true);
    }
    if (event.key === "ArrowLeft" && view === "nodes") {
      event.preventDefault();
      setView("main");
      return;
    }
    if (event.key === "ArrowRight" && event.target instanceof HTMLElement && event.target.hasAttribute("data-add-node")) {
      event.preventDefault();
      setView("nodes");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowUp" ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length;
    const item = items[next];
    item?.focus({ preventScroll: true });
    const list = listRef.current;
    if (!item || !list || !list.contains(item)) return;
    const row = item.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  };

  return (
    <div ref={menuRef} role="menu" tabIndex={-1} data-keyboard-navigation={keyboardNavigation}
      aria-label={menu.type === "node" ? "节点菜单" : view === "nodes" ? "添加节点" : "画布菜单"}
      className={styles.menu} style={{ left: menu.x, top: menu.y, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => setNavigationMode(false)}
      onPointerMove={(event) => {
        if (keyboardNavigationRef.current && (event.movementX !== 0 || event.movementY !== 0)) {
          setNavigationMode(false);
          menuRef.current?.focus({ preventScroll: true });
        }
      }}
      onContextMenu={(event) => event.preventDefault()}>
      {menu.type === "canvas" && view === "nodes" ? (
        <>
          <button type="button" role="menuitem" aria-label="返回画布菜单" onClick={() => setView("main")} className={styles.back}>
            <ChevronLeft aria-hidden /><span>添加节点</span>
          </button>
          <div ref={listRef} className={styles.list}>
            {enabledNodeTypes.map((item) => {
              const Icon = canvasNodeIcon(item.key);
              return (
                <button key={item.key} type="button" role="menuitem" onClick={() => handleAddNode(item.key)} className={styles.nodeItem}>
                  <span className={styles.nodeIcon}><Icon aria-hidden /></span>
                  <span className={styles.nodeText}>
                    <span className={styles.nodeTitle}>{item.title}</span>
                    <span className={styles.description}>{item.description}</span>
                  </span>
                </button>
              );
            })}
            <div className={styles.section}>添加资源</div>
            {RESOURCE_TYPES.map((item) => (
              <button key={item.type} type="button" role="menuitem" disabled={item.type === "upload" ? !onUpload : !onOpenHistory}
                onClick={() => { onClose(); if (item.type === "upload") onUpload?.(); else onOpenHistory?.(); }} className={styles.nodeItem}>
                <span className={styles.nodeIcon}><item.icon aria-hidden /></span>
                <span className={styles.nodeText}>
                  <span className={styles.nodeTitle}>{item.label}</span>
                  <span className={styles.description}>{item.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div ref={listRef} className={styles.list}>
          {menu.type === "canvas" ? (
            <>
              <button type="button" role="menuitem" disabled={!onUpload} onClick={() => { onUpload?.(); onClose(); }} className={styles.item}>
                <UploadIcon aria-hidden /><span>上传</span>
              </button>
              <button type="button" role="menuitem" disabled className={styles.item}>
                <Bookmark aria-hidden /><span>保存到我的素材</span>
              </button>
              <button type="button" role="menuitem" data-add-node onClick={() => setView("nodes")} className={styles.item}>
                <Plus aria-hidden /><span>添加节点</span><ChevronRight className={styles.trailing} aria-hidden />
              </button>
              <div role="separator" className={styles.separator} />
              <button type="button" role="menuitem" disabled={!canUndo} onClick={() => { onUndo?.(); onClose(); }} className={styles.item}>
                <Undo2 aria-hidden /><span>撤销</span><kbd>{shortcut("Z")}</kbd>
              </button>
              <button type="button" role="menuitem" disabled={!canRedo} onClick={() => { onRedo?.(); onClose(); }} className={styles.item}>
                <Redo2 aria-hidden /><span>重做</span><kbd>{shortcut("Z", true)}</kbd>
              </button>
              <button type="button" role="menuitem" disabled={!canPaste} onClick={() => { onPaste?.(menu.worldX, menu.worldY); onClose(); }} className={styles.item}>
                <Clipboard aria-hidden /><span>粘贴</span><kbd>{shortcut("V")}</kbd>
              </button>
            </>
          ) : (
            <>
              {selectedCount >= 2 && (
                <>
                  <button type="button" role="menuitem" onClick={() => { onCreateGroup?.(); onClose(); }} className={styles.item}>
                    <Group aria-hidden /><span>创建分组</span><kbd>{shortcut("G")}</kbd>
                  </button>
                  <div role="separator" className={styles.separator} />
                </>
              )}
              <button type="button" role="menuitem" onClick={() => { if (menu.nodeId) onCopyNode(menu.nodeId); onClose(); }} className={styles.item}>
                <Copy aria-hidden /><span>复制节点</span><kbd>{shortcut("C")}</kbd>
              </button>
              <button type="button" role="menuitem" onClick={() => { onSaveAsset?.(); onClose(); }} className={styles.item}>
                <Bookmark aria-hidden /><span>保存到我的素材</span>
              </button>
              <div role="separator" className={styles.separator} />
              <button type="button" role="menuitem" onClick={() => { if (menu.nodeId) onDeleteNode(menu.nodeId); onClose(); }} className={`${styles.item} ${styles.danger}`}>
                <Trash2 aria-hidden /><span>删除节点</span><kbd>Del</kbd>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
