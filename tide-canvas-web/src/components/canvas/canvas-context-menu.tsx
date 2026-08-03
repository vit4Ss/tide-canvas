"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Upload as UploadIcon, History,
  ChevronLeft, Trash2, Copy, Group,
} from "lucide-react";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";

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
  const nodeTypes = useCanvasNodeConfigStore((state) => state.nodeTypes);
  const enabledNodeTypes = nodeTypes.filter((item) => item.enabled);
  // 两级视图：主菜单 / 添加节点目录（点击下钻替换，而非并排子菜单）
  const [view, setView] = useState<"main" | "nodes">("main");

  // 每次菜单(重新)打开都回到主视图：用 React 推荐的「渲染期对比上次值重置」替代 effect 内 setState
  const [prevMenu, setPrevMenu] = useState(menu);
  if (menu !== prevMenu) {
    setPrevMenu(menu);
    setView("main");
  }

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (!items.length) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowUp"
            ? (current <= 0 ? items.length - 1 : current - 1)
            : (current + 1) % items.length;
      items[next]?.focus();
    };
    if (menu) {
      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [menu, onClose]);

  // 视口夹取:靠屏幕右缘/下缘右键时菜单不能渲染出屏(下方选项点不到)。
  // 菜单高度随视图/类型变化,先隐藏渲染、绘制前实测尺寸后直写定位——
  // useLayoutEffect 在绘制前执行不闪帧,直接改 DOM 避免多一轮 setState 渲染。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))}px`;
    el.style.visibility = "visible";
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu, view]);

  if (!menu) return null;

  const handleAddNode = (type: string) => {
    onAddNode(type, menu.worldX, menu.worldY);
    onClose();
  };

  const itemClass = "mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-xl px-3.5 py-3 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const disabledClass = "mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-xl px-3.5 py-3 text-sm text-neutral-300 dark:text-neutral-600 cursor-not-allowed";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={menu.type === "canvas" ? "画布菜单" : "节点菜单"}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-2.5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      style={{ left: menu.x, top: menu.y, visibility: "hidden" }}
    >
      {menu.type === "canvas" ? (
        view === "nodes" ? (
          <>
            {/* 返回主菜单 */}
            <button
              type="button"
              role="menuitem"
              onClick={() => setView("main")}
              className="flex w-full items-center gap-1 px-4 pb-2 pt-1 text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              添加节点
            </button>
            {enabledNodeTypes.map((item) => {
              const Icon = canvasNodeIcon(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddNode(item.key)}
                  className="group mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-900 group-hover:text-white dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:bg-white dark:group-hover:text-neutral-900">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block font-medium">{item.title}</span>
                    <span className="block max-h-0 truncate text-xs leading-4 text-neutral-400 opacity-0 transition-all duration-200 group-hover:max-h-4 group-hover:opacity-100">{item.description}</span>
                  </span>
                </button>
              );
            })}

            <div className="mt-2 px-4 pb-2 pt-2 text-xs text-neutral-400">添加资源</div>
            {RESOURCE_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  if (item.type === "upload") onUpload?.();
                  else onOpenHistory?.();
                }}
                className="group mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-900 group-hover:text-white dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:bg-white dark:group-hover:text-neutral-900">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block max-h-0 truncate text-xs leading-4 text-neutral-400 opacity-0 transition-all duration-200 group-hover:max-h-4 group-hover:opacity-100">{item.desc}</span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <button type="button" role="menuitem" onClick={() => { onUpload?.(); onClose(); }} className={`${itemClass} font-medium`}>
              <span>上传</span>
            </button>
            {/* 画布空白处没有可保存的媒体,真禁用(此前无 disabled 属性,点击无反应
                菜单也不关,键盘焦点还能落上去,像坏掉的按钮) */}
            <button type="button" role="menuitem" disabled className={disabledClass}>
              <span>保存到我的素材</span>
            </button>
            <button type="button" role="menuitem" onClick={() => setView("nodes")} className={`${itemClass} font-medium`}>
              <span>添加节点</span>
            </button>

            <div className="my-2 mx-3 border-t border-neutral-100 dark:border-neutral-800" />

            <button
              type="button"
              role="menuitem"
              disabled={!canUndo}
              onClick={() => { onUndo?.(); onClose(); }}
              className={canUndo ? itemClass : disabledClass}
            >
              <span>撤销</span>
              <kbd className="text-xs">⌘Z</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canRedo}
              onClick={() => { onRedo?.(); onClose(); }}
              className={canRedo ? itemClass : disabledClass}
            >
              <span>重做</span>
              <kbd className="text-xs">⌘⇧Z</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canPaste}
              onClick={() => { onPaste?.(menu.worldX, menu.worldY); onClose(); }}
              className={canPaste ? `${itemClass} font-medium` : disabledClass}
            >
              <span className={canPaste ? "font-medium" : ""}>粘贴</span>
              <kbd className="text-xs">⌘V</kbd>
            </button>
          </>
        )
      ) : (
        <>
          {selectedCount >= 2 && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { onCreateGroup?.(); onClose(); }}
                className={itemClass}
              >
                <span className="flex items-center gap-2">
                  <Group className="h-4 w-4 text-neutral-500" />
                  创建分组
                </span>
                <kbd className="text-xs text-neutral-400">⌘G</kbd>
              </button>
              <div className="my-2 mx-3 border-t border-neutral-100 dark:border-neutral-800" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { if (menu.nodeId) onCopyNode(menu.nodeId); onClose(); }}
            className={itemClass}
          >
            <span className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-neutral-500" />
              复制节点
            </span>
            <kbd className="text-xs text-neutral-400">⌘C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onSaveAsset?.(); onClose(); }}
            className={itemClass}
          >
            <span>保存到我的素材</span>
          </button>
          <div className="my-2 mx-3 border-t border-neutral-100 dark:border-neutral-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { if (menu.nodeId) onDeleteNode(menu.nodeId); onClose(); }}
            className="mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-xl px-3.5 py-3 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              删除节点
            </span>
            <kbd className="text-xs">Del</kbd>
          </button>
        </>
      )}
    </div>
  );
}
