"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Popover } from "@mantine/core";
import styles from "./styles/parameter-dropdown.module.css";
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
export type VideoGenerationCount = 1 | 2 | 4;
const GENERATION_COUNTS: readonly VideoGenerationCount[] = [1, 2, 4];

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
  audioReadOnly?: boolean;
  audioHint?: string;
  count?: VideoGenerationCount;
  onCountChange?: (count: VideoGenerationCount) => void;
  disabled?: boolean;
}

// 把后台时长(可能是 "4s"/"15s" 字符串且乱序)规整为去重、升序的秒数数组。
// 不规整会渲染成 "4ss"（{n}s 又拼一个 s）且顺序错乱、选中态对不上（数字比字符串）。
export function normalizeDurations(raw?: (string | number)[]): number[] {
  if (!raw) return DURATION_OPTIONS;
  const nums = raw
    .map((d) => (typeof d === "number" ? d : parseInt(String(d), 10)))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

export function VideoParamPicker({
  value, onChange, resolutions, ratios, durations, allowAudio,
  count, onCountChange, disabled = false, audioReadOnly = false, audioHint,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuOpen = open && !disabled;
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
  if (count !== undefined) summaryParts.push(`${count}个`);
  const summary = summaryParts.join(" · ") || "默认";

  return (
    <Popover opened={menuOpen} onChange={setOpen} position="bottom-start" offset={8}
      width={344} withinPortal floatingStrategy="fixed" zIndex={110} radius={12} trapFocus returnFocus
      shadow="none" middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }}
      clickOutsideEvents={["pointerdown"]}
      positionDependencies={[value.ratio, value.resolution, value.duration, ratioOpts.length, resolutionOpts.length, durationOpts.length, count, audioReadOnly, audioHint]}
      transitionProps={{ duration: 100, transition: "fade" }}>
      <Popover.Target>
        <button type="button" className={`${styles.trigger} disabled:cursor-default disabled:opacity-50`} disabled={disabled} aria-haspopup="dialog" aria-expanded={menuOpen}
          aria-label={`视频参数，${summary}`} title="视频参数"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); setOpen(!open); }}
          onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); } }}>
          <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className={styles.triggerText}>{summary}</span>
          {showAudio && (!audioReadOnly || value.audio) && (value.audio ? <Volume2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden /> : <VolumeX className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />)}
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </Popover.Target>
      <Popover.Dropdown role="dialog" aria-label="视频参数" className={styles.panel}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        }}>
        <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0" aria-label="视频参数">
          {/* 只有一个可选值的参数不渲染假按钮，直接在标题行右侧显示为只读值 */}
          {ratioOpts.length === 1 && <ParamSection title="视频尺寸" aside={<StaticValue>{ratioOpts[0].label}</StaticValue>} />}
          {ratioOpts.length > 1 && (
            <ParamSection title="视频尺寸">
              <div className={styles.ratioGrid}>
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

          {count !== undefined && (
            <ParamSection title="生成数量" aside={!onCountChange ? <StaticValue>{count}个</StaticValue> : undefined}>
              {onCountChange && <ChipRow count={GENERATION_COUNTS.length}>
                {GENERATION_COUNTS.map((option) => (
                  <Chip key={option} active={count === option} onClick={() => onCountChange(option)}>{option}个</Chip>
                ))}
              </ChipRow>}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">每个视频单独生成并计费。</p>
            </ParamSection>
          )}

          {showAudio && (
            <ParamSection
              title={audioReadOnly ? "音频" : "生成音频"}
              aside={audioReadOnly ? <StaticValue>按模型默认</StaticValue> : (
                <button
                  type="button"
                  role="switch"
                  aria-label="生成音频"
                  aria-checked={value.audio}
                  onClick={() => onChange({ ...value, audio: !value.audio })}
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${value.audio ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`h-4 w-4 rounded-full transition-transform ${value.audio ? "translate-x-4 bg-primary-foreground" : "bg-muted-foreground"}`} />
                </button>
              )}
            >
              {audioHint && <p className="text-xs leading-5 text-muted-foreground">{audioHint}</p>}
            </ParamSection>
          )}
        </fieldset>
      </Popover.Dropdown>
    </Popover>
  );
}

// 标题行 = 小号灰色说明文字 + 右侧可选内容（只读值/开关）；正文可省（纯展示行）。
function ParamSection({ title, aside, children }: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={`flex h-5 items-center justify-between ${children ? "mb-2" : ""}`}>
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function StaticValue({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium tabular-nums text-popover-foreground">{children}</span>;
}

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
        aria-label="视频时长"
        aria-valuetext={`${value} 秒`}
        className="slider-thin w-full"
        style={{ "--pct": `${pct}%` } as CSSProperties}
      />
    </div>
  );
}

function ChipRow({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className={styles.segmentedRow} style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(count, 4))}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${styles.segmentButton} ${active ? styles.segmentButtonActive : ""}`}
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
      aria-pressed={active}
      className={`${styles.ratioTile} ${active ? styles.ratioTileActive : ""}`}
    >
      <span className="flex h-5 items-center justify-center">
        <span className="block rounded-[2px] border border-current" style={{ width, height } as CSSProperties} />
      </span>
      <span className="leading-none">{option.label}</span>
    </button>
  );
}
