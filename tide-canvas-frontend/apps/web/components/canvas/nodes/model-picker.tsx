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
  return <Sparkles className={`${className} text-neutral-900 dark:text-neutral-100`} />;
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
        <Sparkles className="h-3 w-3 text-neutral-900 dark:text-neutral-100" />
        Lib Image
      </span>
    );
  }

  const selected = models.find((m) => m.modelId === value) || models[0];

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        onClick={(e) => { stop(e); setOpen(!open); }}
        className="flex h-8 max-w-[170px] items-center gap-1.5 rounded-full bg-neutral-100/80 px-2.5 text-xs text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-200/70 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[118px] truncate font-semibold">{selected?.name || "选择模型"}</span>
        <ChevronDown className="h-3 w-3 text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[402px] w-[370px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl shadow-neutral-900/10 [scrollbar-color:#d4d4d8_transparent] [scrollbar-width:thin] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/30">
          {models.map((m) => {
            const isSel = m.modelId === value;
            const { description, estSeconds } = parseMeta(m.config);
            return (
              <button
                key={m.modelId}
                onClick={(e) => { stop(e); onChange(m.modelId); setOpen(false); }}
                className={`group flex h-[56px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left outline-none transition-colors duration-150 ${
                  isSel ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 focus-visible:bg-neutral-50 dark:hover:bg-neutral-800/50 dark:focus-visible:bg-neutral-800/50"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-700 transition-colors group-hover:bg-white dark:bg-neutral-800 dark:text-neutral-200 dark:group-hover:bg-neutral-700/70">
                  <ModelGlyph icon={m.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className={`h-[38px] min-w-0 flex-1 overflow-hidden ${description ? "relative" : "flex items-center"}`}>
                  <span
                    className={`block truncate text-[13px] font-semibold leading-5 text-neutral-900 transition-all duration-150 dark:text-neutral-100 ${
                      description
                        ? "absolute left-0 right-0 top-1/2 -translate-y-1/2 group-hover:top-0 group-hover:translate-y-0 group-focus-visible:top-0 group-focus-visible:translate-y-0"
                        : ""
                    }`}
                  >
                    {m.name}
                  </span>
                  {description && (
                    <span className="absolute left-0 right-0 top-[21px] block translate-y-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                      <span className="block truncate text-[12px] leading-4 text-neutral-400">{description}</span>
                    </span>
                  )}
                </span>
                {estSeconds != null && (
                  <span className="shrink-0 rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] leading-4 tabular-nums text-neutral-500 transition-colors group-hover:bg-white dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:bg-neutral-700/70">{estSeconds}s</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
