"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AiModelVO } from "@/types/ai";

interface Props {
  models: AiModelVO[];
  value: string;
  onChange: (modelId: string) => void;
}

interface ModelMeta {
  description?: string;
  estSeconds?: number;
  isNew: boolean;
  badges: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function hasPositiveNumber(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => typeof record[key] === "number" && Number(record[key]) > 0);
}

function parseMeta(model: AiModelVO): ModelMeta {
  if (!model.config) return { isNew: false, badges: [model.type] };
  try {
    const c = JSON.parse(model.config) as Record<string, unknown>;
    const clarities = stringList(c.clarities);
    const resolutions = stringList(c.resolutions);
    const ratios = stringList(c.ratios);
    const batchSizes = numberList(c.batchSizes);
    const tags = stringList(c.tags);
    const badges: string[] = [];

    if ([...clarities, ...resolutions].some((item) => item.toUpperCase().includes("4K"))) badges.push("超清4K");
    else if (resolutions.some((item) => item.toUpperCase().includes("1080"))) badges.push("1080P");
    if (ratios.length >= 4) badges.push("多尺寸");
    if (batchSizes.some((item) => item > 1)) badges.push("批量生成");
    if (
      hasPositiveNumber(c, ["referenceImageMaxMB", "maxReferenceImageMB", "referenceVideoMaxMB", "maxReferenceVideoMB"]) ||
      model.supportedHandlers?.some((handler) => /ref|image_to_image|video/i.test(handler))
    ) {
      badges.push("多参考图");
    }
    if (c.routeStrategy || Array.isArray(c.routes)) badges.push("智能路由");

    return {
      description: typeof c.description === "string" && c.description.trim() ? c.description.trim() : undefined,
      estSeconds: typeof c.estSeconds === "number" && c.estSeconds > 0 ? c.estSeconds : undefined,
      isNew: c.isNew === true || c.new === true || tags.some((tag) => tag.toLowerCase() === "new"),
      badges: [...badges, ...tags.filter((tag) => tag.toLowerCase() !== "new")].slice(0, 4),
    };
  } catch {
    return { isNew: false, badges: [model.type] };
  }
}

function ModelGlyph({ icon, className = "h-4 w-4" }: { icon?: string; className?: string }) {
  if (icon && /^https?:\/\//.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  if (icon) {
    return <span className="text-base leading-none">{icon}</span>;
  }
  return <Sparkles className={`${className} text-sky-500 dark:text-sky-300`} />;
}

function primaryBadge(isNew: boolean, badges: string[]) {
  return badges.find((badge) => badge.includes("风格") || badge.includes("上新")) || (isNew ? "NEW" : undefined);
}

const PANEL_WIDTH = 372;

export function ModelPicker({ models, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const updatePanelPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const nextOpenUp = spaceBelow < 420;
    const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_WIDTH - 12));
    setOpenUp(nextOpenUp);
    setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - 8 : rect.bottom + 8) });
  };

  const toggle = (e: ReactMouseEvent) => {
    stop(e);
    if (!open) updatePanelPosition();
    setOpen((current) => !current);
  };

  if (models.length === 0) {
    return (
      <span className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 dark:text-neutral-400">
        <Sparkles className="h-3 w-3 text-neutral-900 dark:text-neutral-100" />
        Lib Image
      </span>
    );
  }

  const selected = models.find((m) => m.modelId === value) || models[0];

  if (models.length === 1) {
    return (
      <span
        title={selected?.name || "选择模型"}
        onMouseDown={stop}
        className="flex h-8 max-w-[170px] items-center gap-1.5 rounded-md bg-neutral-100/90 px-2.5 text-xs text-neutral-800 ring-1 ring-black/[0.04] dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[118px] truncate font-semibold">{selected?.name || "选择模型"}</span>
      </span>
    );
  }

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggle}
        className="flex h-8 max-w-[170px] items-center gap-1.5 rounded-md bg-neutral-100/90 px-2.5 text-xs text-neutral-800 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-200/70 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[118px] truncate font-semibold">{selected?.name || "选择模型"}</span>
        <ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label="选择模型"
          className={`fixed z-50 w-[372px] max-w-[calc(100vw-24px)] rounded-xl border border-black/[0.06] bg-white p-3 text-left shadow-[0_22px_70px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#25262b] dark:text-white dark:shadow-black/35 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          <div className="mb-2 text-[14px] font-semibold leading-5 text-neutral-700 dark:text-neutral-200">选择模型</div>
          <div className="max-h-[402px] overflow-y-auto rounded-lg bg-neutral-100 p-1 pr-1.5 [scrollbar-color:#bdbdbd_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable] dark:bg-white/8">
            {models.map((m) => {
              const isSel = m.modelId === value;
              const { description, estSeconds, isNew, badges } = parseMeta(m);
              const badge = primaryBadge(isNew, badges);
              return (
                <button
                  key={m.modelId}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={(e) => {
                    stop(e);
                    onChange(m.modelId);
                    setOpen(false);
                  }}
                  className={`group flex h-[56px] w-full items-center gap-2.5 rounded-md px-2.5 text-left outline-none transition-colors duration-150 ${
                    isSel
                      ? "bg-white text-neutral-950 shadow-sm dark:bg-white dark:text-neutral-950"
                      : "text-neutral-900 hover:bg-white/70 focus-visible:bg-white/70 dark:text-neutral-100 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    isSel ? "bg-neutral-50 text-neutral-700 dark:bg-neutral-100 dark:text-neutral-800" : "bg-white/80 text-neutral-700 dark:bg-white/8 dark:text-neutral-200"
                  }`}>
                    <ModelGlyph icon={m.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className={description ? "relative h-[38px] min-w-0 flex-1 overflow-hidden" : "flex min-w-0 flex-1 items-center"}>
                    <span
                      className={`flex min-w-0 items-center gap-1.5 ${
                        description
                          ? "absolute left-0 right-0 top-1/2 -translate-y-1/2 transition-all duration-150 group-hover:top-0 group-hover:translate-y-0 group-focus-visible:top-0 group-focus-visible:translate-y-0"
                          : ""
                      }`}
                    >
                      <span className="truncate text-[13px] font-semibold leading-5">{m.name}</span>
                      {badge && <span className="shrink-0 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-cyan-600 dark:bg-cyan-300/15 dark:text-cyan-200">{badge}</span>}
                    </span>
                    {description && (
                      <span className="absolute left-0 right-0 top-[21px] block translate-y-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                        <span className="block truncate text-[12px] leading-4 text-neutral-500 dark:text-neutral-400">{description}</span>
                      </span>
                    )}
                  </span>
                  {estSeconds != null && (
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] leading-4 tabular-nums text-neutral-500 dark:bg-white/10 dark:text-neutral-300">{estSeconds}s</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}