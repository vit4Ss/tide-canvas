"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AiModelVO } from "@/types/ai";

interface Props {
  models: AiModelVO[];
  value: string;
  onChange: (modelId: string) => void;
}

/** 从模型 config(JSON) 解析列表展示用的描述与预计耗时（由后台「模型管理」写入） */
function parseMeta(config?: string): { description?: string; estSeconds?: number } {
  if (!config) return {};
  try {
    const c = JSON.parse(config) as { description?: unknown; estSeconds?: unknown };
    return {
      description: typeof c.description === "string" && c.description.trim() ? c.description.trim() : undefined,
      estSeconds: typeof c.estSeconds === "number" && c.estSeconds > 0 ? c.estSeconds : undefined,
    };
  } catch {
    return {};
  }
}

/** 模型图标：URL 图片 / emoji 或文本 / 默认图标 */
function ModelGlyph({ icon, className = "h-4 w-4" }: { icon?: string; className?: string }) {
  if (icon && /^https?:\/\//.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  if (icon) {
    return <span className="text-base leading-none">{icon}</span>;
  }
  return <Sparkles className={`${className} text-blue-500`} />;
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
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate font-medium">{selected?.name || "选择模型"}</span>
        <ChevronDown className="h-3 w-3 text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-[360px] w-[300px] overflow-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          {models.map((m) => {
            const isSel = m.modelId === value;
            const { description, estSeconds } = parseMeta(m.config);
            return (
              <button
                key={m.modelId}
                onClick={(e) => { stop(e); onChange(m.modelId); setOpen(false); }}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  isSel ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-200/70 text-neutral-600 dark:bg-neutral-700/70 dark:text-neutral-200">
                  <ModelGlyph icon={m.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{m.name}</span>
                  {description && (
                    <span className="mt-0.5 block truncate text-xs text-neutral-400">{description}</span>
                  )}
                </span>
                {estSeconds != null && (
                  <span className="shrink-0 text-xs tabular-nums text-neutral-400">{estSeconds}s</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
