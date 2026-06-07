"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Monitor, Volume2, VolumeX, HelpCircle } from "lucide-react";

export interface VideoParamValue {
  /** 画面比例，如 16:9 / 9:16 / auto */
  ratio: string;
  /** 分辨率清晰度：480P / 720P / 1080P */
  resolution: string;
  /** 视频时长（秒） */
  duration: number;
  /** 是否生成音频 */
  audio: boolean;
}

export const VIDEO_RATIOS = [
  { value: "auto", label: "Auto", w: 14, h: 14 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "4:3", label: "4:3", w: 16, h: 12 },
  { value: "1:1", label: "1:1", w: 14, h: 14 },
  { value: "3:4", label: "3:4", w: 12, h: 16 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "21:9", label: "21:9", w: 16, h: 7 },
];

/** 清晰度档位（也用于模型管理「支持清晰度」配置） */
export const RESOLUTIONS = ["480P", "720P", "1080P"];

/** 默认可选时长档位（秒）——模型未配置时回退 */
export const DURATION_OPTIONS = [5, 10];

interface Props {
  value: VideoParamValue;
  onChange: (value: VideoParamValue) => void;
  /** 可选：限定可选的清晰度 / 比例 / 时长档位 / 是否支持音频（来自模型配置），不传则显示全部 */
  resolutions?: string[];
  ratios?: string[];
  durations?: number[];
  allowAudio?: boolean;
}

export function VideoParamPicker({ value, onChange, resolutions, ratios, durations, allowAudio }: Props) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const toggle = (e: React.MouseEvent) => {
    stop(e);
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setOpenUp(window.innerHeight - rect.bottom < 480);
    }
    setOpen(!open);
  };

  // 按模型配置过滤可选项；未配置则显示全部
  const ratioOpts = ratios && ratios.length ? VIDEO_RATIOS.filter((r) => ratios.includes(r.value)) : VIDEO_RATIOS;
  const resolutionOpts = resolutions && resolutions.length ? RESOLUTIONS.filter((r) => resolutions.includes(r)) : RESOLUTIONS;
  const durationOpts = durations && durations.length ? [...durations].sort((a, b) => a - b) : DURATION_OPTIONS;
  const showAudio = allowAudio !== false;
  const durIdx = Math.max(0, durationOpts.indexOf(value.duration));
  const durPct = durationOpts.length > 1 ? Math.round((durIdx / (durationOpts.length - 1)) * 100) : 0;

  const summary = `${value.ratio === "auto" ? "Auto" : value.ratio} · ${value.resolution} · ${value.duration}s`;
  const cellBase = "rounded-lg border px-3 py-2 text-xs transition-colors";
  const cellOn = "border-neutral-900 bg-white text-neutral-900 dark:border-white dark:bg-neutral-900 dark:text-white";
  const cellOff = "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400";

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        onClick={toggle}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <Monitor className="h-3 w-3" />
        {summary}
        {showAudio && (value.audio ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3 opacity-50" />)}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          className={`absolute left-0 z-20 w-[360px] rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {/* 比例 */}
          <div>
            <p className="mb-2 text-xs text-neutral-500">比例</p>
            <div className="grid grid-cols-5 gap-2">
              {ratioOpts.map((r) => {
                const isSelected = value.ratio === r.value;
                const scale = 20 / Math.max(r.w, r.h);
                const iw = Math.round(r.w * scale);
                const ih = Math.round(r.h * scale);
                return (
                  <button
                    key={r.value}
                    onClick={() => onChange({ ...value, ratio: r.value })}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border py-2 transition-colors ${
                      isSelected ? "border-neutral-900 dark:border-white" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700"
                    }`}
                  >
                    <span className="flex h-5 items-center justify-center">
                      <span
                        className={`block rounded-[3px] border-[1.5px] ${isSelected ? "border-neutral-900 dark:border-white" : "border-neutral-400 dark:border-neutral-500"}`}
                        style={{ width: iw, height: ih }}
                      />
                    </span>
                    <span className={`text-[10px] leading-none ${isSelected ? "font-medium text-neutral-900 dark:text-white" : "text-neutral-500"}`}>
                      {r.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 清晰度 */}
          <div className="mt-4">
            <p className="mb-2 text-xs text-neutral-500">清晰度</p>
            <div className="grid grid-cols-3 gap-2">
              {resolutionOpts.map((res) => (
                <button
                  key={res}
                  onClick={() => onChange({ ...value, resolution: res })}
                  className={`${cellBase} ${value.resolution === res ? cellOn : cellOff}`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          {/* 视频时长：档位轴（滑块按档位索引吸附；连续秒数=均匀刻度，非连续=按档位停靠） */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-neutral-500">视频时长</p>
              <span className="text-xs text-neutral-400">{value.duration}s</span>
            </div>
            {durationOpts.length <= 1 ? (
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">{durationOpts[0] ?? value.duration}s</p>
            ) : (
              <>
                <input
                  type="range"
                  min={0}
                  max={durationOpts.length - 1}
                  step={1}
                  value={durIdx}
                  onChange={(e) => onChange({ ...value, duration: durationOpts[Number(e.target.value)] })}
                  style={{ "--pct": `${durPct}%` } as React.CSSProperties}
                  className="slider-thin mt-2 w-full"
                />
                <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                  <span>{durationOpts[0]}s</span>
                  <span>{durationOpts[durationOpts.length - 1]}s</span>
                </div>
              </>
            )}
          </div>

          {/* 生成音频（模型支持时才显示） */}
          {showAudio && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1 text-xs text-neutral-500">
                生成音频 <HelpCircle className="h-3 w-3 text-neutral-400" />
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onChange({ ...value, audio: true })} className={`${cellBase} ${value.audio ? cellOn : cellOff}`}>
                  开启
                </button>
                <button onClick={() => onChange({ ...value, audio: false })} className={`${cellBase} ${!value.audio ? cellOn : cellOff}`}>
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
