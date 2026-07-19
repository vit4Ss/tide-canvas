import type { ImageClarity, ImageQuality, QualityOption, QualityRatioValue, RatioOption } from "../types/quality-ratio";

// 中文注释：这里放所有纯数据与纯函数，供首页创作框和画布节点共同复用。
export const QUALITY_OPTIONS: readonly QualityOption[] = [
  { value: "low", label: "低画质" },
  { value: "standard", label: "标准画质" },
  { value: "high", label: "高画质" },
] as const;

export const CLARITY_OPTIONS: readonly ImageClarity[] = ["1K", "2K", "4K"] as const;

export const RATIO_OPTIONS: readonly RatioOption[] = [
  { value: "auto", label: "自动", w: 14, h: 14 },
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
] as const;

export const DEFAULT_IMAGE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

export function parseRatio(ratio: string): { w: number; h: number } | null {
  if (ratio === "auto") return null;
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

export function getQualityLabel(value: ImageQuality): string {
  return QUALITY_OPTIONS.find((option) => option.value === value)?.label ?? "标准画质";
}

export function getRatioLabel(value: string): string {
  return value === "auto" ? "自动" : value;
}

export function normalizeBatchOptions(options?: readonly number[]): number[] {
  const source = options?.length ? options : DEFAULT_IMAGE_COUNT_OPTIONS;
  return source
    .map((value) => Number(value))
    .filter((value, index, values) => Number.isFinite(value) && value >= 1 && value <= 4 && values.indexOf(value) === index)
    .sort((a, b) => a - b);
}

export function buildQualityRatioSummary(value: QualityRatioValue, batchCount?: number): string {
  const parts = [getRatioLabel(value.ratio), getQualityLabel(value.quality), value.clarity];
  if (batchCount != null) parts.push(`${batchCount}张`);
  return parts.join(" · ");
}

export function getRatioShapeSize(option: Pick<RatioOption, "w" | "h">, maxSize = 13): { width: number; height: number } {
  const scale = maxSize / Math.max(option.w, option.h);
  return {
    width: Math.max(4, Math.round(option.w * scale)),
    height: Math.max(4, Math.round(option.h * scale)),
  };
}
