import type { CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelVO } from "@/types/ai";

export function supportsVideoReference(model: Pick<AiModelVO, "supportedHandlers">): boolean {
  return !model.supportedHandlers?.length || model.supportedHandlers.includes("reference_to_video");
}

export function selectClipReshootModel(
  models: readonly AiModelVO[],
  preferredModelId: string,
): AiModelVO | undefined {
  return models.find((model) => model.modelId === preferredModelId && supportsVideoReference(model))
    ?? models.find(supportsVideoReference);
}

function positiveFinite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mediaRatio(source: CanvasNode, fallback: string): string {
  if (source.aspectRatio?.trim()) return source.aspectRatio;
  const width = positiveFinite(source.mediaWidth);
  const height = positiveFinite(source.mediaHeight);
  if (!width || !height) return fallback;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const roundedW = Math.round(width);
  const roundedH = Math.round(height);
  const divisor = gcd(roundedW, roundedH) || 1;
  return `${roundedW / divisor}:${roundedH / divisor}`;
}

function parseTimecode(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }
  const [hours, minutes, seconds] = parts;
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

export interface ClipReshootRange {
  raw: string;
  start: number;
  end: number;
}

export const CLIP_RESHOOT_MAX_RANGES = 5;
export const CLIP_RESHOOT_DEFAULT_SECONDS = 5;
export const CLIP_RESHOOT_MIN_SECONDS = 0.5;

type ClipReshootSelectionRange = Pick<ClipReshootRange, "start" | "end">;

export function normalizeClipReshootRanges(
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  duration: number,
): ClipReshootSelectionRange[] {
  const safeDuration = positiveFinite(duration) ?? CLIP_RESHOOT_DEFAULT_SECONDS;
  const candidates = (ranges ?? [])
    .flatMap((range) => {
      const start = Math.max(0, Math.min(safeDuration, Number(range.start)));
      const end = Math.max(0, Math.min(safeDuration, Number(range.end)));
      return Number.isFinite(start) && Number.isFinite(end) && end - start >= CLIP_RESHOOT_MIN_SECONDS
        ? [{ start, end }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
  const normalized: ClipReshootSelectionRange[] = [];
  for (const candidate of candidates) {
    const start = Math.max(candidate.start, normalized.at(-1)?.end ?? 0);
    if (candidate.end - start < CLIP_RESHOOT_MIN_SECONDS) continue;
    normalized.push({ start, end: candidate.end });
    if (normalized.length >= CLIP_RESHOOT_MAX_RANGES) break;
  }
  return normalized.length > 0
    ? normalized
    : [{ start: 0, end: Math.min(CLIP_RESHOOT_DEFAULT_SECONDS, safeDuration) }];
}

export function addClipReshootRange(
  ranges: ReadonlyArray<ClipReshootSelectionRange> | undefined,
  duration: number,
  at: number,
): { ranges: ClipReshootSelectionRange[]; activeIndex: number; changed: boolean } {
  const safeDuration = positiveFinite(duration) ?? CLIP_RESHOOT_DEFAULT_SECONDS;
  const normalized = normalizeClipReshootRanges(ranges, safeDuration);
  const time = Math.max(0, Math.min(safeDuration, Number(at) || 0));
  const existingIndex = normalized.findIndex((range) => time >= range.start && time <= range.end);
  if (existingIndex >= 0) return { ranges: normalized, activeIndex: existingIndex, changed: false };
  if (normalized.length >= CLIP_RESHOOT_MAX_RANGES) {
    return { ranges: normalized, activeIndex: -1, changed: false };
  }

  const previous = [...normalized].reverse().find((range) => range.end <= time);
  const nextRange = normalized.find((range) => range.start >= time);
  const gapStart = previous?.end ?? 0;
  const gapEnd = nextRange?.start ?? safeDuration;
  const length = Math.min(CLIP_RESHOOT_DEFAULT_SECONDS, gapEnd - gapStart);
  if (length < CLIP_RESHOOT_MIN_SECONDS) {
    return { ranges: normalized, activeIndex: -1, changed: false };
  }

  let start = Math.max(gapStart, time - length / 2);
  const end = Math.min(gapEnd, start + length);
  start = Math.max(gapStart, end - length);
  const next = normalizeClipReshootRanges([...normalized, { start, end }], safeDuration);
  return {
    ranges: next,
    activeIndex: next.findIndex((range) => Math.abs(range.start - start) < 0.01),
    changed: true,
  };
}

export function resizeClipReshootRange(
  ranges: ReadonlyArray<ClipReshootSelectionRange> | undefined,
  duration: number,
  index: number,
  edge: "start" | "end",
  at: number,
): ClipReshootSelectionRange[] {
  const safeDuration = positiveFinite(duration) ?? CLIP_RESHOOT_DEFAULT_SECONDS;
  const next = normalizeClipReshootRanges(ranges, safeDuration).map((range) => ({ ...range }));
  const target = next[index];
  if (!target) return next;
  const time = Math.max(0, Math.min(safeDuration, Number(at) || 0));
  const previousEnd = next[index - 1]?.end ?? 0;
  const nextStart = next[index + 1]?.start ?? safeDuration;
  if (edge === "start") {
    target.start = Math.max(previousEnd, Math.min(time, target.end - CLIP_RESHOOT_MIN_SECONDS));
  } else {
    target.end = Math.min(nextStart, Math.max(time, target.start + CLIP_RESHOOT_MIN_SECONDS));
  }
  return normalizeClipReshootRanges(next, safeDuration);
}

export function formatClipReshootTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const roundedTenths = Math.round(safeSeconds * 10);
  const minutes = Math.floor(roundedTenths / 600);
  const rounded = (roundedTenths - minutes * 600) / 10;
  const secondsText = Number.isInteger(rounded)
    ? String(rounded).padStart(2, "0")
    : rounded.toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${secondsText}`;
}

export function buildClipReshootRangeInstruction(
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  duration: number,
  sourceLabel = "参考视频",
): string {
  const normalized = normalizeClipReshootRanges(ranges, duration);
  return `仅重拍${sourceLabel}中的以下片段：${normalized
    .map((range) => `${formatClipReshootTime(range.start)}–${formatClipReshootTime(range.end)}`)
    .join("、")}。未选中的画面保持不变。`;
}

export function extractClipReshootRanges(prompt: string): Array<ClipReshootRange | { raw: string; invalid: true }> {
  const ranges: Array<ClipReshootRange | { raw: string; invalid: true }> = [];
  const pattern = /(\d+(?::\d+){1,2}(?:\.\d+)?)\s*(?:-|–|—|~|～|至|到)\s*(\d+(?::\d+){1,2}(?:\.\d+)?)/g;
  for (const match of prompt.matchAll(pattern)) {
    const raw = match[0];
    const start = parseTimecode(match[1]);
    const end = parseTimecode(match[2]);
    ranges.push(start == null || end == null ? { raw, invalid: true } : { raw, start, end });
  }
  return ranges;
}

/** 没写时间段时允许按普通提示词提交；一旦写了时间段，就要求格式、顺序和视频边界都有效。 */
export function validateClipReshootPrompt(prompt: string, sourceDuration?: number): string | null {
  const ranges = extractClipReshootRanges(prompt);
  for (const range of ranges) {
    if ("invalid" in range) return `时间段“${range.raw}”格式无效，秒数需小于 60`;
    if (range.end <= range.start) return `时间段“${range.raw}”的结束时间必须晚于开始时间`;
    if (sourceDuration && range.end > sourceDuration + 0.05) {
      return `时间段“${range.raw}”超出原视频时长（${sourceDuration.toFixed(1)} 秒）`;
    }
  }
  return null;
}

export function buildClipReshootNode(input: {
  source: CanvasNode;
  id: string;
  x: number;
  y: number;
  modelId: string;
  ratio: string;
  resolution: string;
  duration: number;
}): CanvasNode {
  const { source, id, x, y, modelId, ratio, resolution, duration } = input;
  const actualDuration = positiveFinite(source.mediaDuration)
    ?? positiveFinite(source.generationConfig?.duration)
    ?? positiveFinite(duration)
    ?? 5;
  return {
    id,
    type: "video",
    x,
    y,
    width: source.width,
    height: source.height,
    contentW: source.contentW,
    contentH: source.contentH,
    title: source.videoOperation === "clip_reshoot"
      ? source.title || "片段重拍"
      : `${source.title || "视频节点"} · 片段重拍`,
    prompt: "",
    aspectRatio: mediaRatio(source, ratio),
    generationConfig: {
      ...source.generationConfig,
      modelId,
      resolution: source.generationConfig?.resolution ?? resolution,
      duration: Math.max(1, Math.round(actualDuration)),
    },
    videoOperation: "clip_reshoot",
    clipReshootSourceId: source.id,
    clipReshootRanges: [{
      start: 0,
      end: Math.min(CLIP_RESHOOT_DEFAULT_SECONDS, actualDuration),
    }],
    status: "idle",
  };
}
