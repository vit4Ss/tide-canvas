"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, RectangleHorizontal } from "lucide-react";

export interface QualityRatioValue {
  quality: "low" | "standard" | "high";
  clarity: "1K" | "2K" | "4K";
  ratio: string;
}

export const QUALITY_OPTIONS = [
  { value: "low", label: "低画质" },
  { value: "standard", label: "标准画质" },
  { value: "high", label: "高画质" },
] as const;

export const CLARITY_OPTIONS = ["1K", "2K", "4K"] as const;

interface RatioOption {
  value: string;
  label: string;
  w: number;
  h: number;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { value: "auto", label: "智能比例", w: 14, h: 14 },
  { value: "1:1", label: "1:1", w: 14, h: 14 },
  { value: "1:2", label: "1:2", w: 8, h: 16 },
  { value: "2:1", label: "2:1", w: 16, h: 8 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "3:4", label: "3:4", w: 12, h: 16 },
  { value: "4:3", label: "4:3", w: 16, h: 12 },
  { value: "3:2", label: "3:2", w: 16, h: 11 },
  { value: "2:3", label: "2:3", w: 11, h: 16 },
  { value: "5:4", label: "5:4", w: 16, h: 13 },
  { value: "4:5", label: "4:5", w: 13, h: 16 },
  { value: "21:9", label: "21:9", w: 16, h: 7 },
  { value: "9:21", label: "9:21", w: 7, h: 16 },
];

export function parseRatio(ratio: string): { w: number; h: number } | null {
  if (ratio === "auto") return null;
  const [w, h] = ratio.split(":").map(Number);
  return { w, h };
}

interface Props {
  value: QualityRatioValue;
  onChange: (value: QualityRatioValue) => void;
  qualities?: string[];
  clarities?: string[];
  ratios?: string[];
  compact?: boolean;
  batchCount?: number;
  batchOptions?: number[];
  onBatchChange?: (value: number) => void;
}

const PANEL_WIDTH = 372;

export function QualityRatioPicker({ value, onChange, qualities, clarities, ratios, compact = false, batchCount, batchOptions, onBatchChange }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const qualityOpts = qualities ? QUALITY_OPTIONS.filter((q) => qualities.includes(q.value)) : [...QUALITY_OPTIONS];
  const clarityOpts = clarities ? CLARITY_OPTIONS.filter((c) => clarities.includes(c)) : [...CLARITY_OPTIONS];
  const ratioOpts = ratios ? RATIO_OPTIONS.filter((r) => ratios.includes(r.value)) : RATIO_OPTIONS;
  const normalizedBatchOptions = batchOptions?.length ? [...batchOptions].sort((a, b) => a - b) : [];
  const showBatch = batchCount != null && normalizedBatchOptions.length > 0 && !!onBatchChange;

  const qualityLabel = QUALITY_OPTIONS.find((q) => q.value === value.quality)?.label || "标准画质";
  const ratioLabel = value.ratio === "auto" ? "智能比例" : value.ratio;
  const summaryParts: string[] = [];
  if (ratioOpts.length) summaryParts.push(ratioLabel);
  if (qualityOpts.length) summaryParts.push(qualityLabel);
  if (clarityOpts.length) summaryParts.push(value.clarity);
  if (showBatch) summaryParts.push(`${batchCount}张`);
  const summary = summaryParts.join(" · ") || "默认";

  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const toggle = (e: ReactMouseEvent) => {
    stop(e);
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const nextOpenUp = spaceBelow < 500;
      const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_WIDTH - 12));
      setOpenUp(nextOpenUp);
      setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - 8 : rect.bottom + 8) });
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={`${compact ? "h-7" : "h-8"} flex max-w-[240px] items-center gap-1.5 rounded-md px-2 text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800`}
      >
        <RectangleHorizontal className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{summary}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 w-[372px] max-w-[calc(100vw-24px)] rounded-xl border border-black/[0.06] bg-white p-3 text-left shadow-[0_22px_70px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#25262b] dark:shadow-black/35 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          {qualityOpts.length > 0 && (
            <ParamSection title="图像质量">
              <SegmentedRow count={qualityOpts.length}>
                {qualityOpts.map((opt) => (
                  <SegmentButton key={opt.value} active={value.quality === opt.value} onClick={() => onChange({ ...value, quality: opt.value })}>
                    {opt.label}
                  </SegmentButton>
                ))}
              </SegmentedRow>
            </ParamSection>
          )}

          {clarityOpts.length > 0 && (
            <ParamSection title="清晰度">
              <SegmentedRow count={clarityOpts.length}>
                {clarityOpts.map((c) => (
                  <SegmentButton key={c} active={value.clarity === c} onClick={() => onChange({ ...value, clarity: c })}>
                    {c}
                  </SegmentButton>
                ))}
              </SegmentedRow>
            </ParamSection>
          )}

          {ratioOpts.length > 0 && (
            <ParamSection title="图片尺寸">
              <div className="grid grid-cols-6 gap-x-1 gap-y-2 rounded-lg bg-neutral-100 p-2 dark:bg-white/8">
                {ratioOpts.map((r) => (
                  <RatioTile key={r.value} option={r} active={value.ratio === r.value} onClick={() => onChange({ ...value, ratio: r.value })} />
                ))}
              </div>
            </ParamSection>
          )}

          {showBatch && (
            <ParamSection title="图片张数">
              <SegmentedRow count={normalizedBatchOptions.length}>
                {normalizedBatchOptions.map((count) => (
                  <SegmentButton key={count} active={batchCount === count} onClick={() => onBatchChange(count)}>
                    {count}
                  </SegmentButton>
                ))}
              </SegmentedRow>
            </ParamSection>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ParamSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="not-first:mt-4">
      <div className="mb-2 text-[14px] font-semibold leading-5 text-neutral-700 dark:text-neutral-200">{title}</div>
      {children}
    </section>
  );
}

function SegmentedRow({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className="grid rounded-lg bg-neutral-100 p-1 dark:bg-white/8" style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${active ? "bg-white text-neutral-950 shadow-sm dark:bg-white dark:text-neutral-950" : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"} flex h-9 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors`}
    >
      {children}
    </button>
  );
}

function RatioTile({ option, active, onClick }: { option: RatioOption; active: boolean; onClick: () => void }) {
  const scale = 18 / Math.max(option.w, option.h);
  const width = Math.max(4, Math.round(option.w * scale));
  const height = Math.max(4, Math.round(option.h * scale));

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${active ? "bg-white text-neutral-950 shadow-sm dark:bg-white dark:text-neutral-950" : "text-neutral-500 hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"} flex h-[50px] flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors`}
    >
      <span className="flex h-5 items-center justify-center">
        <span className="block rounded-[2px] border border-current" style={{ width, height } as CSSProperties} />
      </span>
      <span className="leading-none">{option.label}</span>
    </button>
  );
}