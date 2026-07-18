"use client";

import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Monitor, Scan, Volume2, VolumeX } from "lucide-react";
import {
  LEGACY_VIDEO_DURATIONS,
  LEGACY_VIDEO_RESOLUTIONS,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
} from "@/lib/video-model-config";
import { useDismissibleCanvasOverlay, useExclusiveCanvasOverlay } from "../canvas-overlay-coordinator";
import styles from "./styles/video-param-picker.module.css";

export interface VideoParamValue {
  ratio: string;
  resolution: string;
  duration: number;
  audio: boolean;
}

export { VIDEO_RATIOS };
export const RESOLUTIONS = [...VIDEO_RESOLUTIONS];
export const DURATION_OPTIONS = [...VIDEO_DURATIONS];

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

interface VideoParamControlsProps extends Props {
  composer?: boolean;
}

const PANEL_WIDTH = 344;
const PANEL_MAX_HEIGHT = 420;

export function VideoParamPicker({ value, onChange, resolutions, ratios, durations, allowAudio }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const [panelMaxHeight, setPanelMaxHeight] = useState(PANEL_MAX_HEIGHT);
  const closeOverlay = useCallback(() => setOpen(false), []);
  const announceOpen = useExclusiveCanvasOverlay(open, closeOverlay, "video-params");
  useDismissibleCanvasOverlay(open, closeOverlay, [triggerRef, panelRef]);

  const ratioOpts = ratios ? VIDEO_RATIOS.filter((r) => ratios.includes(r.value)) : VIDEO_RATIOS;
  const resolutionOpts = resolutions ? VIDEO_RESOLUTIONS.filter((r) => resolutions.includes(r)) : LEGACY_VIDEO_RESOLUTIONS;
  const durationOpts = durations ? VIDEO_DURATIONS.filter((duration) => durations.includes(duration)) : [...LEGACY_VIDEO_DURATIONS];

  const summaryParts: string[] = [];
  if (ratioOpts.length) summaryParts.push(value.ratio === "auto" ? "智能比例" : value.ratio);
  if (resolutionOpts.length) summaryParts.push(value.resolution);
  if (durationOpts.length) summaryParts.push(`${value.duration}s`);
  const summary = summaryParts.join(" · ") || "默认";

  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const toggle = (e: ReactMouseEvent) => {
    stop(e);
    if (!open && triggerRef.current) {
      announceOpen();
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
      const spaceAbove = Math.max(0, rect.top - gap - margin);
      const nextOpenUp = spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow;
      const availableHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, nextOpenUp ? spaceAbove : spaceBelow));
      const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_WIDTH - 12));
      setOpenUp(nextOpenUp);
      setPanelMaxHeight(availableHeight);
      setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - gap : rect.bottom + gap) });
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="flex h-7 max-w-[250px] items-center gap-1.5 rounded-md px-2 text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/8"
      >
        <Monitor className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{summary}</span>
        {value.audio ? <Volume2 className="h-3 w-3 shrink-0 text-neutral-500" /> : <VolumeX className="h-3 w-3 shrink-0 text-neutral-400" />}
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className={`${styles.panel} ${openUp ? styles.panelOpenUp : ""}`}
          style={{ left: panelPos.left, top: panelPos.top, maxHeight: panelMaxHeight, overflowY: "auto" }}
          onMouseDown={stop}
          onWheel={(event) => event.stopPropagation()}
        >
          <VideoParamControls
            value={value}
            onChange={onChange}
            ratios={ratioOpts.map((option) => option.value)}
            resolutions={[...resolutionOpts]}
            durations={durationOpts}
            allowAudio={allowAudio}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function VideoParamControls({
  value,
  onChange,
  resolutions,
  ratios,
  durations,
  allowAudio = true,
  composer = false,
}: VideoParamControlsProps) {
  const ratioOpts = ratios ? VIDEO_RATIOS.filter((option) => ratios.includes(option.value)) : VIDEO_RATIOS;
  const resolutionOpts = resolutions
    ? VIDEO_RESOLUTIONS.filter((resolution) => resolutions.includes(resolution))
    : [...LEGACY_VIDEO_RESOLUTIONS];
  const durationOpts = durations
    ? VIDEO_DURATIONS.filter((duration) => durations.includes(duration))
    : [...LEGACY_VIDEO_DURATIONS];

  return (
    <div className={`${styles.controls} ${composer ? styles.controlsComposer : ""}`}>
      {ratioOpts.length > 0 && (
        <ParamSection title="画面比例">
          <div className={styles.ratioGrid}>
            {ratioOpts.map((ratio) => (
              <RatioTile
                key={ratio.value}
                option={ratio}
                active={value.ratio === ratio.value}
                onClick={() => onChange({ ...value, ratio: ratio.value })}
              />
            ))}
          </div>
        </ParamSection>
      )}

      {resolutionOpts.length > 0 && (
        <ParamSection title="清晰度">
          <SegmentedRow count={resolutionOpts.length}>
            {resolutionOpts.map((resolution) => (
              <SegmentButton
                key={resolution}
                active={value.resolution === resolution}
                onClick={() => onChange({ ...value, resolution })}
              >
                {resolution}
              </SegmentButton>
            ))}
          </SegmentedRow>
        </ParamSection>
      )}

      {durationOpts.length > 0 && (
        <ParamSection title="视频时长">
          <DurationSlider
            options={durationOpts}
            value={value.duration}
            onChange={(duration) => onChange({ ...value, duration })}
          />
        </ParamSection>
      )}

      <ParamSection title="生成音频">
        <SegmentedRow count={2}>
          <SegmentButton
            active={allowAudio && value.audio}
            disabled={!allowAudio}
            onClick={() => onChange({ ...value, audio: true })}
          >
            开启
          </SegmentButton>
          <SegmentButton active={!value.audio} onClick={() => onChange({ ...value, audio: false })}>关闭</SegmentButton>
        </SegmentedRow>
      </ParamSection>
    </div>
  );
}

function DurationSlider({ options, value, onChange }: { options: number[]; value: number; onChange: (value: number) => void }) {
  const activeIndex = Math.max(0, options.indexOf(value));
  const maxIndex = Math.max(0, options.length - 1);
  const progress = maxIndex === 0 ? 0 : (activeIndex / maxIndex) * 100;
  const style = { "--duration-progress": `${progress}%` } as CSSProperties;

  return (
    <div className={styles.durationSlider}>
      <div className={styles.durationValueRow}>
        <output className={styles.durationValue} style={{ left: `${progress}%` }}>{options[activeIndex]}s</output>
      </div>
      <input
        className={styles.durationRange}
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={activeIndex}
        disabled={options.length <= 1}
        aria-label="视频时长"
        aria-valuetext={`${options[activeIndex]}秒`}
        style={style}
        onChange={(event) => onChange(options[Number(event.target.value)] ?? options[0])}
      />
      <div className={styles.durationEndpoints}>
        <span>{options[0]}s</span>
        {options.length > 1 && <span>{options[options.length - 1]}s</span>}
      </div>
    </div>
  );
}

function ParamSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </section>
  );
}

function SegmentedRow({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className={styles.segmentedRow} style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function SegmentButton({ active, disabled = false, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
      title={option.label}
      aria-label={option.label}
      aria-pressed={active}
      className={`${styles.ratioTile} ${active ? styles.ratioTileActive : ""}`}
    >
      <span className={styles.ratioShapeWrap}>
        {option.value === "auto"
          ? <Scan className={styles.autoRatioIcon} aria-hidden="true" />
          : <span className={styles.ratioShape} style={{ width, height } as CSSProperties} />}
      </span>
      <span className={styles.ratioLabel}>{option.label}</span>
    </button>
  );
}
