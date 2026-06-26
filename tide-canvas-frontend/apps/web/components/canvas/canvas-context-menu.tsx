"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignLeft, ImageIcon, Video, Layers, AudioLines, Clapperboard,
  Upload as UploadIcon, History,
  ChevronLeft, Trash2, Copy, Group,
} from "lucide-react";

export interface ContextMenuState {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  type: "canvas" | "node";
  nodeId?: string;
}

interface NodeTypeItem {
  type: string;
  label: string;
  desc: string;
  icon: typeof AlignLeft;
}

const NODE_TYPES: NodeTypeItem[] = [
  { type: "text", label: "文本", desc: "输入文字 / 提示词", icon: AlignLeft },
  { type: "image", label: "图片", desc: "AI 生成或上传图片", icon: ImageIcon },
  { type: "video", label: "视频", desc: "AI 生成或上传视频", icon: Video },
  { type: "scene_3d", label: "导演台", desc: "3D 场景编排与运镜", icon: Layers },
  { type: "audio", label: "音频", desc: "AI 生成或上传音频", icon: AudioLines },
  { type: "script", label: "脚本", desc: "撰写 / 生成分镜脚本", icon: Clapperboard },
];

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
  onSaveAsset?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: (worldX: number, worldY: number) => void;
}

export function CanvasContextMenu({
  menu, canUndo = false, canRedo = false, canPaste = false, selectedCount = 0,
  onClose, onAddNode, onDeleteNode, onCopyNode, onCreateGroup,
  onUpload, onSaveAsset, onUndo, onRedo, onPaste,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
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
      if (e.key === "Escape") onClose();
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
      className="fixed z-50 w-64 rounded-2xl border border-neutral-200 bg-white py-2.5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.type === "canvas" ? (
        view === "nodes" ? (
          <>
            {/* 返回主菜单 */}
            <button
              onClick={() => setView("main")}
              className="flex w-full items-center gap-1 px-4 pb-2 pt-1 text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              添加节点
            </button>
            {NODE_TYPES.map((item) => (
              <button
                key={item.type}
                onClick={() => handleAddNode(item.type)}
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

            <div className="mt-2 px-4 pb-2 pt-2 text-xs text-neutral-400">添加资源</div>
            {RESOURCE_TYPES.map((item) => (
              <button
                key={item.type}
                onClick={() => { onClose(); if (item.type === "upload") onUpload?.(); }}
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
            <button onClick={() => { onUpload?.(); onClose(); }} className={`${itemClass} font-medium`}>
              <span>上传</span>
            </button>
            <button className={disabledClass}>
              <span>保存到我的素材</span>
            </button>
            <button onClick={() => setView("nodes")} className={`${itemClass} font-medium`}>
              <span>添加节点</span>
            </button>

            <div className="my-2 mx-3 border-t border-neutral-100 dark:border-neutral-800" />

            <button
              disabled={!canUndo}
              onClick={() => { onUndo?.(); onClose(); }}
              className={canUndo ? itemClass : disabledClass}
            >
              <span>撤销</span>
              <kbd className="text-xs">⌘Z</kbd>
            </button>
            <button
              disabled={!canRedo}
              onClick={() => { onRedo?.(); onClose(); }}
              className={canRedo ? itemClass : disabledClass}
            >
              <span>重做</span>
              <kbd className="text-xs">⌘⇧Z</kbd>
            </button>
            <button
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
            onClick={() => { onSaveAsset?.(); onClose(); }}
            className={itemClass}
          >
            <span>保存到我的素材</span>
          </button>
          <div className="my-2 mx-3 border-t border-neutral-100 dark:border-neutral-800" />
          <button
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
