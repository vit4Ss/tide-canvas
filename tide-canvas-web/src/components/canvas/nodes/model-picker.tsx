"use client";

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import type { AiModelVO } from "@/types/ai";

interface Props {
  models: AiModelVO[];
  value: string;
  onChange: (modelId: string) => void;
  /** 紧凑入口使用固定触发文案；模型详情仍在 title 与弹层内完整呈现。 */
  triggerLabel?: string;
  /** 混合图片/视频模型时在选项旁显示类型，单类型节点选择器默认不显示。 */
  showType?: boolean;
  /** Portal 无法继承调用处主题；深色入口显式指定，保证弹层与触发区一致。 */
  tone?: "default" | "dark";
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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  if (icon && !icon.includes("<svg")) {
    return <span className="text-base leading-none">{icon}</span>;
  }
  return <Sparkles className={`${className} text-neutral-500 dark:text-neutral-300`} />;
}

function modelTypeLabel(type: string) {
  if (type === "image") return "图片";
  if (type === "video") return "视频";
  if (type === "audio") return "音频";
  if (type === "text") return "文本";
  return type;
}

function primaryBadge(isNew: boolean, badges: string[]) {
  return badges.find((badge) => badge.includes("风格") || badge.includes("上新")) || (isNew ? "NEW" : undefined);
}

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 384;

export function ModelPicker({ models, value, onChange, triggerLabel, showType = false, tone = "default" }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const [panelMaxHeight, setPanelMaxHeight] = useState(PANEL_MAX_HEIGHT);
  const [activeModelId, setActiveModelId] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const typeaheadRef = useRef({ value: "", resetTimer: 0 as number | undefined });

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  const updatePanelPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gutter = 12;
    const gap = 8;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - gutter);
    const spaceAbove = Math.max(0, rect.top - gap - gutter);
    const nextOpenUp = spaceAbove > spaceBelow;
    const availableSpace = nextOpenUp ? spaceAbove : spaceBelow;
    const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_WIDTH - 12));
    setOpenUp(nextOpenUp);
    setPanelMaxHeight(Math.max(72, Math.min(PANEL_MAX_HEIGHT, availableSpace - 12)));
    setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - 8 : rect.bottom + 8) });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (containerRef.current?.contains(target) || panelRef.current?.contains(target))
      ) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const onReposition = () => updatePanelPosition();
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    window.visualViewport?.addEventListener("resize", onReposition);
    window.visualViewport?.addEventListener("scroll", onReposition);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      window.visualViewport?.removeEventListener("resize", onReposition);
      window.visualViewport?.removeEventListener("scroll", onReposition);
    };
  }, [open]);

  useEffect(() => () => {
    if (typeaheadRef.current.resetTimer != null) window.clearTimeout(typeaheadRef.current.resetTimer);
  }, []);

  const toggle = (event: ReactMouseEvent) => {
    stop(event);
    if (!open) {
      updatePanelPosition();
      setActiveModelId(models.find((model) => model.modelId === value)?.modelId ?? models[0]?.modelId ?? "");
    }
    setOpen((current) => !current);
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => {
        const focusable = Array.from(document.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((element) =>
          !panelRef.current?.contains(element) &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
        );
        const triggerIndex = triggerRef.current ? focusable.indexOf(triggerRef.current) : -1;
        if (triggerIndex < 0) return;
        const nextIndex = event.shiftKey ? triggerIndex - 1 : triggerIndex + 1;
        focusable[(nextIndex + focusable.length) % focusable.length]?.focus();
      });
      return;
    }
    if (!panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const query = `${typeaheadRef.current.value}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current.value = query;
      if (typeaheadRef.current.resetTimer != null) window.clearTimeout(typeaheadRef.current.resetTimer);
      typeaheadRef.current.resetTimer = window.setTimeout(() => {
        typeaheadRef.current.value = "";
        typeaheadRef.current.resetTimer = undefined;
      }, 600);
      const matchIndex = models.findIndex((model) => model.name.toLocaleLowerCase().startsWith(query));
      if (matchIndex < 0) return;
      event.preventDefault();
      setActiveModelId(models[matchIndex].modelId);
      items[matchIndex]?.focus();
      return;
    } else return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  if (models.length === 0) {
    return (
      <span className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-normal text-neutral-500 dark:text-neutral-400">
        <Sparkles className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-300" />
        {triggerLabel || "暂无模型"}
      </span>
    );
  }

  const selected = models.find((model) => model.modelId === value) || models[0];

  if (models.length === 1) {
    if (value !== selected.modelId) {
      return (
        <button
          type="button"
          title={`切换到 ${selected.name || "可用模型"}`}
          aria-label={`切换到 ${selected.name || "可用模型"}`}
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            onChange(selected.modelId);
          }}
          className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs text-neutral-800 transition-[background-color,box-shadow] hover:bg-neutral-100/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 dark:text-neutral-200 dark:hover:bg-white/8 dark:hover:shadow-black/20"
        >
          <ModelGlyph icon={selected.icon} className="h-3.5 w-3.5" />
          <span className="min-w-0 max-w-[134px] truncate font-normal">{triggerLabel || selected.name || "选择模型"}</span>
        </button>
      );
    }
    return (
      <span
        title={selected?.name || "选择模型"}
        onMouseDown={stop}
        className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs text-neutral-800 transition-[background-color,box-shadow] hover:bg-neutral-100/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 dark:text-neutral-200 dark:hover:bg-white/8 dark:hover:shadow-black/20"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[134px] truncate font-normal">{triggerLabel || selected?.name || "选择模型"}</span>
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
        aria-controls={open ? panelId : undefined}
        aria-label={`${triggerLabel || "模型"}，当前 ${selected?.name || "未选择"}`}
        title={`${triggerLabel || "模型"}：${selected?.name || "未选择"}`}
        onClick={toggle}
        className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-md px-2.5 text-xs text-neutral-700 dark:text-neutral-300"
      >
        <ModelGlyph icon={selected?.icon} className="h-3.5 w-3.5" />
        <span className="min-w-0 max-w-[134px] truncate font-normal">{triggerLabel || selected?.name || "选择模型"}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          id={panelId}
          ref={panelRef}
          role="listbox"
          aria-label="选择模型"
          className={`fixed z-[90] w-[360px] max-w-[calc(100vw-24px)] rounded-xl border p-1.5 text-left ${
            tone === "dark"
              ? "dark border-white/12 bg-[#1c1c20] text-white shadow-[0_16px_44px_rgba(0,0,0,0.34)]"
              : "border-neutral-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.16)] dark:border-white/12 dark:bg-[#1c1c20] dark:text-white dark:shadow-black/35"
          } ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
          onKeyDown={handleListKeyDown}
        >
          <div
            className="model-picker-scroll overflow-y-auto pr-1 [scrollbar-color:#b7b7b7_transparent] [scrollbar-width:thin]"
            style={{ maxHeight: panelMaxHeight }}
          >
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
                  tabIndex={model.modelId === activeModelId ? 0 : -1}
                  onFocus={() => setActiveModelId(model.modelId)}
                  onClick={(event) => {
                    stop(event);
                    onChange(model.modelId);
                    setOpen(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }}
                  className={`group flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-inset ${
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
                      {showType && <span className="shrink-0 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">{modelTypeLabel(model.type)}</span>}
                      {badge && <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-neutral-600 dark:bg-white/10 dark:text-neutral-300">{badge}</span>}
                    </span>
                    {description && (
                      <span className="block truncate text-[12px] leading-4 text-neutral-500 dark:text-neutral-400">
                        {description}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {estSeconds != null && (
                      <span className="rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] leading-4 tabular-nums text-neutral-500 ring-1 ring-black/[0.03] dark:bg-white/8 dark:text-neutral-300 dark:ring-white/10">
                        {estSeconds}s
                      </span>
                    )}
                    {isSelected && <Check aria-hidden className="h-4 w-4 text-neutral-900 dark:text-white" />}
                  </span>
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
