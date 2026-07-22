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
  // 后台把时长存成带单位的字符串("4s")，甚至乱序；这里容错接收 string|number。
  durations?: (string | number)[];
  allowAudio?: boolean;
}

const PANEL_WIDTH = 372;

// 把后台时长(可能是 "4s"/"15s" 字符串且乱序)规整为去重、升序的秒数数组。
// 不规整会渲染成 "4ss"（{n}s 又拼一个 s）且顺序错乱、选中态对不上（数字比字符串）。
export function normalizeDurations(raw?: (string | number)[]): number[] {
  if (!raw) return DURATION_OPTIONS;
  const nums = raw
    .map((d) => (typeof d === "number" ? d : parseInt(String(d), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

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

  // 后台配置的取值以配置为准,内置表仅提供显示样式:配了白名单外的值(如 "2:1"/"2K")
  // 时不能整段过滤消失——节点校正 effect 已把参数设成该值、摘要也显示它,
  // 选项一旦被滤掉用户就无处更改。白名单外的比例按数值推导缩略图形状。
  const ratioOpts = ratios
    ? ratios
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((v) => {
          const builtin = VIDEO_RATIOS.find((r) => r.value === v);
          if (builtin) return builtin;
          const [w, h] = v.split(":").map(Number);
          if (!(w > 0) || !(h > 0)) return { value: v, label: v, w: 14, h: 14 };
          const scale = 16 / Math.max(w, h);
          return { value: v, label: v, w: Math.max(4, Math.round(w * scale)), h: Math.max(4, Math.round(h * scale)) };
        })
    : VIDEO_RATIOS;
  // 清晰度大小写容错：后台存小写 "720p"，内置是 "720P"——命中内置用内置显示值,
  // 白名单外的值(如 "2K")原样大写展示,不过滤。
  const resolutionOpts = resolutions
    ? resolutions
        .map((x) => RESOLUTIONS.find((r) => r.toLowerCase() === x.toLowerCase()) ?? x.toUpperCase())
        .filter((v, i, arr) => arr.indexOf(v) === i)
    : RESOLUTIONS;
  const durationOpts = normalizeDurations(durations);
  const showAudio = allowAudio !== false;

  const summaryParts: string[] = [];
  if (ratioOpts.length) summaryParts.push(value.ratio === "auto" ? "智能比例" : value.ratio);
  if (resolutionOpts.length) summaryParts.push(value.resolution.toUpperCase());
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
          className={`fixed z-50 w-[372px] max-w-[calc(100vw-24px)] rounded-xl border border-black/[0.06] bg-white p-4 text-left shadow-[0_16px_50px_rgba(15,23,42,0.14)] dark:border-white/10 dark:bg-[#25262b] dark:shadow-black/35 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          {/* 只有一个可选值的参数不渲染假按钮，直接在标题行右侧显示为只读值 */}
          {ratioOpts.length === 1 && <ParamSection title="视频尺寸" aside={<StaticValue>{ratioOpts[0].label}</StaticValue>} />}
          {ratioOpts.length > 1 && (
            <ParamSection title="视频尺寸">
              <div className="grid grid-cols-6 gap-1.5">
                {ratioOpts.map((ratio) => (
                  <RatioTile key={ratio.value} option={ratio} active={value.ratio === ratio.value} onClick={() => onChange({ ...value, ratio: ratio.value })} />
                ))}
              </div>
            </ParamSection>
          )}

          {resolutionOpts.length === 1 && <ParamSection title="清晰度" aside={<StaticValue>{resolutionOpts[0]}</StaticValue>} />}
          {resolutionOpts.length > 1 && (
            <ParamSection title="清晰度">
              <ChipRow count={resolutionOpts.length}>
                {resolutionOpts.map((res) => (
                  <Chip key={res} active={value.resolution.toLowerCase() === res.toLowerCase()} onClick={() => onChange({ ...value, resolution: res })}>
                    {res}
                  </Chip>
                ))}
              </ChipRow>
            </ParamSection>
          )}

          {durationOpts.length === 1 && <ParamSection title="视频时长" aside={<StaticValue>{durationOpts[0]}s</StaticValue>} />}
          {durationOpts.length > 1 && durationOpts.length <= 6 && (
            <ParamSection title="视频时长">
              <ChipRow count={durationOpts.length}>
                {durationOpts.map((duration) => (
                  <Chip key={duration} active={value.duration === duration} onClick={() => onChange({ ...value, duration })}>
                    {duration}s
                  </Chip>
                ))}
              </ChipRow>
            </ParamSection>
          )}
          {durationOpts.length > 6 && (
            <ParamSection title="视频时长" aside={<StaticValue>{value.duration}s</StaticValue>}>
              <DurationSlider options={durationOpts} value={value.duration} onChange={(duration) => onChange({ ...value, duration })} />
            </ParamSection>
          )}

          {showAudio && (
            <ParamSection
              title="生成音频"
              aside={
                <button
                  type="button"
                  role="switch"
                  aria-checked={value.audio}
                  onClick={() => onChange({ ...value, audio: !value.audio })}
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${value.audio ? "bg-neutral-900 dark:bg-white/85" : "bg-neutral-200 dark:bg-white/15"}`}
                >
                  <span className={`h-4 w-4 rounded-full bg-white transition-transform ${value.audio ? "translate-x-4 dark:bg-neutral-900" : "dark:bg-neutral-400"}`} />
                </button>
              }
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// 标题行 = 小号灰色说明文字 + 右侧可选内容（只读值/开关）；正文可省（纯展示行）。
function ParamSection({ title, aside, children }: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className="not-first:mt-5">
      <div className={`flex h-5 items-center justify-between ${children ? "mb-2" : ""}`}>
        <span className="text-xs font-medium text-neutral-500 dark:text-white/50">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function StaticValue({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium tabular-nums text-neutral-900 dark:text-white/90">{children}</span>;
}

// 选中态：细黑描边（安静、不抢内容）；未选中：弱边框轮廓。全面板统一这一套状态。
const chipActive = "border-neutral-900 text-neutral-950 dark:border-white/80 dark:text-white";
const chipRest =
  "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900 dark:border-white/12 dark:text-white/60 dark:hover:border-white/25 dark:hover:text-white/90";

// 时长选项多(>6)时按钮挤不下，改用细轨道滑块（样式同图片节点的 .slider-thin），
// 当前值显示在标题行右侧。选项可能不连续(如 4,6,8,12)，滑块走索引再映射回秒数。
function DurationSlider({ options, value, onChange }: { options: number[]; value: number; onChange: (v: number) => void }) {
  const idx = Math.max(0, options.indexOf(value));
  const pct = options.length > 1 ? (idx / (options.length - 1)) * 100 : 100;
  return (
    <div className="px-0.5 pt-1">
      <input
        type="range"
        min={0}
        max={options.length - 1}
        step={1}
        value={idx}
        onChange={(e) => onChange(options[Number(e.target.value)])}
        className="slider-thin w-full"
        style={{ "--pct": `${pct}%` } as CSSProperties}
      />
    </div>
  );
}

function ChipRow({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${active ? chipActive : chipRest} flex h-8 items-center justify-center rounded-lg border text-[13px] font-medium transition-colors`}
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
      className={`${active ? chipActive : chipRest} flex h-[52px] flex-col items-center justify-center gap-1 rounded-[10px] border text-[11px] font-medium transition-colors`}
    >
      <span className="flex h-5 items-center justify-center">
        <span className="block rounded-[2px] border border-current" style={{ width, height } as CSSProperties} />
      </span>
      <span className="leading-none">{option.label}</span>
    </button>
  );
}