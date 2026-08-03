"use client";

import { useEffect, useRef } from "react";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";

interface Props {
  menu: { clientX: number; clientY: number } | null;
  onClose: () => void;
  onSelect: (type: string) => void;
}

/** 从端口拖出连线、在空白处松手时弹出：选择类型即新建节点并自动连线 */
export function CanvasQuickAddMenu({ menu, onClose, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const nodeTypes = useCanvasNodeConfigStore((state) => state.nodeTypes);
  const enabledNodeTypes = nodeTypes.filter((item) => item.enabled);

  useEffect(() => {
    if (!menu) return;
    const focusFrame = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 下一帧再绑定，避免开启它的这次交互立即把它关掉
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      cancelAnimationFrame(focusFrame);
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // 视口夹取:把连线拖到屏幕右缘/下缘松手时,菜单不能渲染出屏(选项点不到)。
  // 高度按条目数估算(标题 ~28 + 每项 ~40 + padding)，并限制在视口内。
  const MENU_W = 176;
  const menuH = Math.min(28 + enabledNodeTypes.length * 40 + 16, window.innerHeight - 16);
  const left = Math.max(8, Math.min(menu.clientX, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(menu.clientY, window.innerHeight - menuH - 8));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="新建并连接节点"
      className="fixed z-50 w-44 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-2 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      style={{ left, top, maxHeight: "calc(100vh - 16px)" }}
    >
      <div className="px-3 pb-1 text-xs text-neutral-400">新建并连接</div>
      {enabledNodeTypes.map((item) => {
        const Icon = canvasNodeIcon(item.key);
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            onClick={() => onSelect(item.key)}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-medium">{item.title}</span>
          </button>
        );
      })}
    </div>
  );
}
