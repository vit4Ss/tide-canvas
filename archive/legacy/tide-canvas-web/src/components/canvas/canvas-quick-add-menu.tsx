"use client";

import { useEffect, useRef } from "react";
import { AlignLeft, Image as ImageIcon, Video, Scissors, Layers, AudioLines, FileCode2 } from "lucide-react";

const NODE_TYPES = [
  { type: "text", label: "文本", icon: AlignLeft },
  { type: "image", label: "图片", icon: ImageIcon },
  { type: "video", label: "视频", icon: Video },
  { type: "video_compose", label: "视频合成", icon: Scissors },
  { type: "scene_3d", label: "导演台", icon: Layers },
  { type: "audio", label: "音频", icon: AudioLines },
  { type: "script", label: "脚本", icon: FileCode2 },
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

  return (
    <div
      ref={ref}
      className="fixed z-50 w-44 rounded-xl border border-neutral-200 bg-white py-2 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      style={{ left: menu.clientX, top: menu.clientY }}
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
