"use client";

import { useEffect, useRef } from "react";
import { AlignLeft, Image as ImageIcon, Video, Layers, AudioLines, Clapperboard } from "lucide-react";

const NODE_TYPES = [
  { type: "text", label: "文本", icon: AlignLeft },
  { type: "image", label: "图片", icon: ImageIcon },
  { type: "video", label: "视频", icon: Video },
  { type: "scene_3d", label: "导演台", icon: Layers },
  { type: "audio", label: "音频", icon: AudioLines },
  { type: "script", label: "脚本", icon: Clapperboard },
];

interface Props {
  menu: { clientX: number; clientY: number } | null;
  onClose: () => void;
  onSelect: (type: string) => void;
}

/** 从端口拖出连线、在空白处松手时弹出：选择类型即新建节点并自动连线 */
export function CanvasQuickAddMenu({ menu, onClose, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
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
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
  const left = Math.min(Math.max(12, menu.clientX), Math.max(12, viewportWidth - 188));
  const top = Math.min(Math.max(12, menu.clientY), Math.max(12, viewportHeight - 326));

  return (
    <div
      ref={ref}
      className="fixed z-[1100] w-44 rounded-xl border border-neutral-200 bg-white py-2 shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#202124]"
      style={{ left, top }}
    >
      <div className="px-3 pb-1 text-xs text-neutral-400">新建并连接</div>
      {NODE_TYPES.map((item) => (
        <button
          key={item.type}
          onClick={() => onSelect(item.type)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <item.icon className="h-4 w-4" />
          </span>
          <span className="font-medium">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
