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
    status: "idle",
  };
}
