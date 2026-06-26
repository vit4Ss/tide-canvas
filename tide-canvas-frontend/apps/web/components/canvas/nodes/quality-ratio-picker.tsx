"use client";

import { useEffect, useRef, useState } from "react";
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
  { value: "auto", label: "自适应", w: 14, h: 14 },
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

/** 解析 ratio 字符串为 width/height 数值（auto 返回 null） */
export function parseRatio(ratio: string): { w: number; h: number } | null {
  if (ratio === "auto") return null;
  const [w, h] = ratio.split(":").map(Number);
  return { w, h };
}

interface Props {
  value: QualityRatioValue;
  onChange: (value: QualityRatioValue) => void;
  /** 可选：限定可选的画质/清晰度/比例（来自模型配置），不传则显示全部 */
  qualities?: string[];
  clarities?: string[];
  ratios?: string[];
  compact?: boolean;
}

export function QualityRatioPicker({ value, onChange, qualities, clarities, ratios, compact = false }: Props) {
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
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // 维度语义：undefined(模型未配置) = 显示全部；空数组(后台明确全不勾) = 该模型无此维度，隐藏区块
  const qualityOpts = qualities ? QUALITY_OPTIONS.filter((q) => qualities.includes(q.value)) : [...QUALITY_OPTIONS];
  const clarityOpts = clarities ? CLARITY_OPTIONS.filter((c) => clarities.includes(c)) : [...CLARITY_OPTIONS];
  const ratioOpts = ratios ? RATIO_OPTIONS.filter((r) => ratios.includes(r.value)) : RATIO_OPTIONS;

  const qualityLabel = QUALITY_OPTIONS.find((q) => q.value === value.quality)?.label || "标准画质";
  const ratioLabel = value.ratio === "auto" ? "自适应" : value.ratio;
  const summaryParts: string[] = [];
  if (ratioOpts.length) summaryParts.push(ratioLabel);
  if (qualityOpts.length) summaryParts.push(qualityLabel);
  if (clarityOpts.length) summaryParts.push(value.clarity);
  const summary = summaryParts.join(" · ") || "默认";

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // 展开前判断方向：下方空间充足则向下展开（不遮挡上方输入框），否则向上
  const toggle = (e: React.MouseEvent) => {
    stop(e);
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 440);
      setPanelPos({ left: Math.round(rect.left), top: Math.round(spaceBelow < 440 ? rect.top - 8 : rect.bottom + 8) });
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        onClick={toggle}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <RectangleHorizontal className="h-3 w-3" />
        {summary}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 w-[340px] rounded-xl border border-neutral-200 bg-white p-4 shadow-xl shadow-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/30 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          {/* 画质 */}
          {qualityOpts.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-neutral-500">画质</p>
            <div className="grid grid-cols-3 gap-2">
              {qualityOpts.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...value, quality: opt.value })}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    value.quality === opt.value
                      ? "border-neutral-900 bg-white text-neutral-900 dark:border-white dark:bg-neutral-900 dark:text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* 清晰度 */}
          {clarityOpts.length > 0 && (
          <div className="mt-4 first:mt-0">
            <p className="mb-2 text-xs text-neutral-500">清晰度</p>
            <div className="grid grid-cols-3 gap-2">
              {clarityOpts.map((c) => (
                <button
                  key={c}
                  onClick={() => onChange({ ...value, clarity: c })}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    value.clarity === c
                      ? "border-neutral-900 bg-white text-neutral-900 dark:border-white dark:bg-neutral-900 dark:text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* 比例 */}
          {ratioOpts.length > 0 && (
          <div className="mt-4 first:mt-0">
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
                      isSelected
                        ? "border-neutral-900 dark:border-white"
                        : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700"
                    }`}
                  >
                    <span className="flex h-5 items-center justify-center">
                      <span
                        className={`block rounded-[3px] border-[1.5px] ${
                          isSelected
                            ? "border-neutral-900 dark:border-white"
                            : "border-neutral-400 dark:border-neutral-500"
                        }`}
                        style={{ width: iw, height: ih }}
                      />
                    </span>
                    <span
                      className={`text-[10px] leading-none ${
                        isSelected ? "font-medium text-neutral-900 dark:text-white" : "text-neutral-500"
                      }`}
                    >
                      {r.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
