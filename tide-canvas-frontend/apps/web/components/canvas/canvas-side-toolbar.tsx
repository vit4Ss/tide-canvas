"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Plus, Workflow, PenTool, Clock, HelpCircle, Headphones,
  AlignLeft, Image as ImageIcon, Video, Layers, AudioLines, Clapperboard,
} from "lucide-react";
import { toast } from "@/components/shared/toast";

const NODE_TYPES: { type: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { type: "image", label: "图片", icon: ImageIcon },
  { type: "video", label: "视频", icon: Video },
  { type: "text", label: "文本", icon: AlignLeft },
  { type: "audio", label: "音频", icon: AudioLines },
  { type: "scene_3d", label: "导演台", icon: Layers },
  { type: "script", label: "脚本", icon: Clapperboard },
];

interface Props {
  /** 在视口中心新建指定类型的节点 */
  onAddNode: (type: string) => void;
  /** 自动排列节点 */
  onArrange: () => void;
  /** 打开「我的素材」面板 */
  onOpenAssets: () => void;
  /** 素材面板是否打开（高亮按钮） */
  assetsActive?: boolean;
  /** 打开「历史」面板 */
  onOpenHistory: () => void;
  /** 历史面板是否打开 */
  historyActive?: boolean;
}

/** 画布左侧悬浮垂直工具栏 */
export function CanvasSideToolbar({ onAddNode, onArrange, onOpenAssets, assetsActive, onOpenHistory, historyActive }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // 点外部 / Esc 关闭「添加」菜单
  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAddOpen(false); };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);

  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      {/* 添加节点 */}
      <div ref={addRef} className="relative">
        <button
          onClick={() => setAddOpen((v) => !v)}
          title="添加节点"
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
            addOpen
              ? "bg-neutral-700 text-white dark:bg-neutral-200 dark:text-neutral-900"
              : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          }`}
        >
          <Plus className="h-5 w-5" />
        </button>
        {addOpen && (
          <div className="absolute left-full top-0 z-30 ml-3 w-40 rounded-xl border border-neutral-200 bg-white py-2 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="px-3 pb-1 text-xs text-neutral-400">新建节点</div>
            {NODE_TYPES.map((item) => (
              <button
                key={item.type}
                onClick={() => { onAddNode(item.type); setAddOpen(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ToolButton icon={Workflow} label="自动排列" onClick={onArrange} />
      <ToolButton icon={PenTool} label="我的素材" onClick={onOpenAssets} active={assetsActive} />
      <ToolButton icon={Clock} label="历史" onClick={onOpenHistory} active={historyActive} />

      <div className="my-0.5 h-px w-6 bg-neutral-200 dark:bg-neutral-700" />

      <ToolButton icon={HelpCircle} label="帮助" onClick={() => toast.info("「帮助」即将上线")} />
      <ToolButton icon={Headphones} label="客服" onClick={() => toast.info("「客服」即将上线")} />
    </div>
  );
}

function ToolButton({
  icon: Icon, label, onClick, active,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
          active
            ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white"
            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>
      <span className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 opacity-0 shadow-md transition-opacity group-hover:opacity-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
        {label}
      </span>
    </div>
  );
}
