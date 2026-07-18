"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles } from "lucide-react";
import type { AiModelVO } from "@/types/ai";
import { useDismissibleCanvasOverlay, useExclusiveCanvasOverlay } from "../canvas-overlay-coordinator";

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

function pickPositiveNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function hasPositiveNumber(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => pickPositiveNumber(record, [key]) != null);
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
      estSeconds: pickPositiveNumber(c, ["estSeconds", "estimatedSeconds", "durationSeconds", "seconds", "timeSeconds"]),
      isNew: c.isNew === true || c.new === true || tags.some((tag) => tag.toLowerCase() === "new"),
      badges: [...badges, ...tags.filter((tag) => tag.toLowerCase() !== "new")].slice(0, 4),
    };
  } catch {
    return { isNew: false, badges: [model.type] };
  }
}

function ModelGlyph({ icon, className = "h-4 w-4" }: { icon?: string; className?: string }) {
  if (icon && /^(https?:|data:image|\/)/.test(icon)) {

    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  if (icon && !icon.includes("<svg")) {
    return <span className="text-base leading-none">{icon}</span>;
  }
  return <Sparkles className={`${className} text-sky-500 dark:text-sky-300`} />;
}

function primaryBadge(isNew: boolean, badges: string[]) {
  return badges.find((badge) => badge.includes("风格") || badge.includes("上新")) || (isNew ? "NEW" : undefined);
}

const PANEL_WIDTH = 386;
const PANEL_MAX_HEIGHT = 408;

export function ModelPicker({ models, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const [panelMaxHeight, setPanelMaxHeight] = useState(PANEL_MAX_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeOverlay = useCallback(() => setOpen(false), []);
  const announceOpen = useExclusiveCanvasOverlay(open, closeOverlay, "model-picker");
  useDismissibleCanvasOverlay(open, closeOverlay, [triggerRef, panelRef]);

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  const updatePanelPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
    const spaceAbove = Math.max(0, rect.top - gap - margin);
    const nextOpenUp = spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow;
    const availableHeight = Math.max(96, Math.min(PANEL_MAX_HEIGHT, nextOpenUp ? spaceAbove : spaceBelow));
    const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_WIDTH - 12));
    setOpenUp(nextOpenUp);
    setPanelMaxHeight(availableHeight);
    setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - gap : rect.bottom + gap) });
  };

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePanelPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const toggle = (event: ReactMouseEvent) => {
    stop(event);
    if (!open) {
      announceOpen();
      updatePanelPosition();
    }
    setOpen((current) => !current);
  };

  if (models.length === 0) {
    return (
      <span className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-normal text-neutral-800 transition-[background-color,box-shadow] hover:bg-neutral-100/80 hover:shadow-sm dark:text-neutral-200 dark:hover:bg-white/8 dark:hover:shadow-black/20">
        <Sparkles className="h-3.5 w-3.5 text-sky-500" />
        Lib Image
      </span>
    );
  }

  const selected = models.find((model) => model.modelId === value) || models[0];

  if (models.length === 1) {
    return (
      <span
        title={selected?.name || "选择模型"}
        onMouseDown={stop}
        className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs text-neutral-800 transition-[background-color,box-shadow] hover:bg-neutral-100/80 hover:shadow-sm dark:text-neutral-200 dark:hover:bg-white/8 dark:hover:shadow-black/20"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[134px] truncate font-normal">{selected?.name || "选择模型"}</span>
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
        title={selected?.name || "选择模型"}
        onClick={toggle}
        className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs text-neutral-800 transition-[background-color,box-shadow] hover:bg-neutral-100/80 hover:shadow-sm dark:text-neutral-200 dark:hover:bg-white/8 dark:hover:shadow-black/20"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[134px] truncate font-normal">{selected?.name || "选择模型"}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label="选择模型"
          className={`fixed z-[1200] w-[386px] max-w-[calc(100vw-24px)] rounded-xl border border-neutral-200 bg-white p-1.5 text-left shadow-[0_18px_48px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#202124] dark:text-white dark:shadow-black/40 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="model-picker-scroll overflow-y-auto pr-1 [scrollbar-color:#b7b7b7_transparent] [scrollbar-width:thin]" style={{ maxHeight: panelMaxHeight }}>
            {models.map((model) => {
              const isSelected = model.modelId === selected.modelId;
              const { description, estSeconds, isNew, badges } = parseMeta(model);
              const badge = primaryBadge(isNew, badges);
              return (
                <button
                  key={model.modelId}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={(event) => {
                    stop(event);
                    onChange(model.modelId);
                    setOpen(false);
                  }}
                  className={`group flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 ${
                    isSelected
                      ? "bg-neutral-100 text-neutral-950 dark:bg-white/12 dark:text-white"
                      : "text-neutral-900 hover:bg-neutral-50 focus-visible:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-white/8 dark:focus-visible:bg-white/8"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)] dark:bg-white/8 dark:text-neutral-200">
                    <ModelGlyph icon={model.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold leading-5">{model.name}</span>
                      {badge && <span className="shrink-0 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-cyan-600 dark:bg-cyan-300/15 dark:text-cyan-200">{badge}</span>}
                    </span>
                    {description && (
                      <span className={`truncate text-[12px] leading-4 text-neutral-500 dark:text-neutral-400 ${isSelected ? "block" : "hidden group-hover:block group-focus-visible:block"}`}>
                        {description}
                      </span>
                    )}
                  </span>
                  {estSeconds != null && (
                    <span className="shrink-0 rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] leading-4 tabular-nums text-neutral-500 ring-1 ring-black/[0.03] dark:bg-white/8 dark:text-neutral-300 dark:ring-white/10">
                      {estSeconds}s
                    </span>
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
