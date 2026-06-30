"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Monitor, Volume2, VolumeX } from "lucide-react";

export interface VideoParamValue {
  ratio: string;
  resolution: string;
  duration: number;
  audio: boolean;
}

export const VIDEO_RATIOS = [
  { value: "auto", label: "智能比例", w: 14, h: 14 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "4:3", label: "4:3", w: 16, h: 12 },
  { value: "1:1", label: "1:1", w: 14, h: 14 },
  { value: "3:4", label: "3:4", w: 12, h: 16 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "21:9", label: "21:9", w: 16, h: 7 },
];

export const RESOLUTIONS = ["480P", "720P", "1080P"];
export const DURATION_OPTIONS = [5, 10];

interface RatioOption {
  value: string;
  label: string;
  w: number;
  h: number;
}

interface Props {
  value: VideoParamValue;
  onChange: (value: VideoParamValue) => void;
  resolutions?: string[];
  ratios?: string[];
  durations?: number[];
  allowAudio?: boolean;
}

const PANEL_WIDTH = 372;

export function VideoParamPicker({ value, onChange, resolutions, ratios, durations, allowAudio }: Props) {
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

  const ratioOpts = ratios ? VIDEO_RATIOS.filter((r) => ratios.includes(r.value)) : VIDEO_RATIOS;
  const resolutionOpts = resolutions ? RESOLUTIONS.filter((r) => resolutions.includes(r)) : RESOLUTIONS;
  const durationOpts = durations ? [...durations].sort((a, b) => a - b) : DURATION_OPTIONS;
  const showAudio = allowAudio !== false;

  const summaryParts: string[] = [];
  if (ratioOpts.length) summaryParts.push(value.ratio === "auto" ? "智能比例" : value.ratio);
  if (resolutionOpts.length) summaryParts.push(value.resolution);
  if (durationOpts.length) summaryParts.push(`${value.duration}s`);
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
        className="flex h-8 max-w-[250px] items-center gap-1.5 rounded-md px-2 text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Monitor className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{summary}</span>
        {showAudio && (value.audio ? <Volume2 className="h-3 w-3 shrink-0 text-neutral-500" /> : <VolumeX className="h-3 w-3 shrink-0 text-neutral-400" />)}
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 w-[372px] max-w-[calc(100vw-24px)] rounded-xl border border-black/[0.06] bg-white p-3 text-left shadow-[0_22px_70px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#25262b] dark:shadow-black/35 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          {ratioOpts.length > 0 && (
            <ParamSection title="视频尺寸">
              <div className="grid grid-cols-6 gap-x-1 gap-y-2 rounded-lg bg-neutral-100 p-2 dark:bg-white/8">
                {ratioOpts.map((ratio) => (
                  <RatioTile key={ratio.value} option={ratio} active={value.ratio === ratio.value} onClick={() => onChange({ ...value, ratio: ratio.value })} />
                ))}
              </div>
            </ParamSection>
          )}

          {resolutionOpts.length > 0 && (
            <ParamSection title="清晰度">
              <SegmentedRow count={resolutionOpts.length}>
                {resolutionOpts.map((res) => (
                  <SegmentButton key={res} active={value.resolution === res} onClick={() => onChange({ ...value, resolution: res })}>
                    {res}
                  </SegmentButton>
                ))}
              </SegmentedRow>
            </ParamSection>
          )}

          {durationOpts.length > 0 && (
            <ParamSection title="视频时长">
              <SegmentedRow count={durationOpts.length}>
                {durationOpts.map((duration) => (
                  <SegmentButton key={duration} active={value.duration === duration} onClick={() => onChange({ ...value, duration })}>
                    {duration}s
                  </SegmentButton>
                ))}
              </SegmentedRow>
            </ParamSection>
          )}

          {showAudio && (
            <ParamSection title="生成音频">
              <SegmentedRow count={2}>
                <SegmentButton active={value.audio} onClick={() => onChange({ ...value, audio: true })}>开启</SegmentButton>
                <SegmentButton active={!value.audio} onClick={() => onChange({ ...value, audio: false })}>关闭</SegmentButton>
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