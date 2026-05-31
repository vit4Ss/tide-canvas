"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AiModelVO } from "@/types/ai";

interface Props {
  models: AiModelVO[];
  value: string;
  onChange: (modelId: string) => void;
}

/** 渲染模型图标：URL 图片 / emoji 或文本 / 默认图标 */
function ModelIcon({ icon }: { icon?: string }) {
  if (icon && /^https?:\/\//.test(icon)) {
    return <img src={icon} alt="" className="h-4 w-4 rounded object-cover" />;
  }
  if (icon) {
    return <span className="text-xs leading-none">{icon}</span>;
  }
  return <Sparkles className="h-3 w-3 text-blue-500" />;
}

export function ModelPicker({ models, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // 未配置模型时回退为静态展示
  if (models.length === 0) {
    return (
      <span className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400">
        <Sparkles className="h-3 w-3 text-blue-500" />
        Lib Image
      </span>
    );
  }

  const selected = models.find((m) => m.modelId === value) || models[0];

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        onClick={(e) => { stop(e); setOpen(!open); }}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <ModelIcon icon={selected?.icon} />
        {selected?.name || "选择模型"}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-64 w-52 overflow-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          {models.map((m) => {
            const isSel = m.modelId === value;
            return (
              <button
                key={m.modelId}
                onClick={(e) => { stop(e); onChange(m.modelId); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  isSel
                    ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <ModelIcon icon={m.icon} />
                </span>
                <span className="flex-1 truncate">{m.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
