"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Upload as UploadIcon, History,
  ChevronLeft, Trash2, Copy, Group,
  type LucideIcon,
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

interface CatalogItemButtonProps {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}

/**
 * 节点与资源目录共用的固定行高条目。
 * 52px = 36px 图标 + 上下各 8px；说明文字绝对定位，只做位移与透明度动画，
 * 因此 hover / focus-visible 不会改变菜单高度或触发相邻条目重排。
 */
function CatalogItemButton({ label, description, icon: Icon, onClick }: CatalogItemButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="group mx-2 flex h-[52px] w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-2.5 text-sm transition-colors hover:bg-neutral-100 motion-reduce:transition-none dark:hover:bg-neutral-800"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-900 group-hover:text-white group-focus-visible:bg-neutral-900 group-focus-visible:text-white motion-reduce:transition-none dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:bg-white dark:group-hover:text-neutral-900 dark:group-focus-visible:bg-white dark:group-focus-visible:text-neutral-900">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="relative h-9 min-w-0 flex-1 overflow-hidden text-left">
        <span className="absolute inset-x-0 top-2 block truncate font-medium leading-5 transition-transform duration-200 ease-out group-hover:-translate-y-2 group-focus-visible:-translate-y-2 motion-reduce:transition-none">
          {label}
        </span>
        <span className="absolute inset-x-0 bottom-0 block translate-y-1 truncate text-xs leading-4 text-neutral-400 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
          {description}
        </span>
      </span>
    </button>
  );
}

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
                <CatalogItemButton
                  key={item.key}
                  label={item.title}
                  description={item.description}
                  icon={Icon}
                  onClick={() => handleAddNode(item.key)}
                />
              );
            })}

            <div className="mt-2 px-4 pb-2 pt-2 text-xs text-neutral-400">添加资源</div>
            {RESOURCE_TYPES.map((item) => (
              <CatalogItemButton
                key={item.type}
                label={item.label}
                description={item.desc}
                icon={item.icon}
                onClick={() => {
                  onClose();
                  if (item.type === "upload") onUpload?.();
                  else onOpenHistory?.();
                }}
              />
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
