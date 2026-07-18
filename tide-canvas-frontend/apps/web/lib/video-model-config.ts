export const VIDEO_RATIOS = [
  { value: "auto", label: "自动", w: 14, h: 14 },
  { value: "21:9", label: "21:9", w: 16, h: 7 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "4:3", label: "4:3", w: 16, h: 12 },
  { value: "1:1", label: "1:1", w: 14, h: 14 },
  { value: "3:4", label: "3:4", w: 12, h: 16 },
  { value: "9:16", label: "9:16", w: 9, h: 16 },
] as const;

export const VIDEO_RESOLUTIONS = ["480P", "720P", "768P", "1080P", "4K"] as const;
export const VIDEO_DURATIONS = Array.from({ length: 27 }, (_, index) => index + 4);

export const LEGACY_VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export const LEGACY_VIDEO_DURATIONS = [5, 10] as const;

export interface VideoSecondPrice {
  withoutAudio?: number;
  withAudio?: number;
}

export interface VideoModelConfig {
  ratios?: string[];
  resolutions?: string[];
  durations?: number[];
  audio?: boolean;
  secondPricing?: Record<string, VideoSecondPrice>;
  [key: string]: unknown;
}

export interface VideoParamSelection {
  ratio: string;
  resolution: string;
  duration: number;
  audio: boolean;
}

export interface VideoModelOptions {
  ratios: string[];
  resolutions: string[];
  durations: number[];
  allowAudio: boolean;
}

const VIDEO_PARAM_MEMORY_KEY = "tc:video-model-params:v1";

export function parseVideoModelConfig(value: unknown): VideoModelConfig {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as VideoModelConfig;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as VideoModelConfig : {};
  } catch {
    return {};
  }
}

function orderedStrings(values: unknown, options: readonly string[], fallback: readonly string[]): string[] {
  const source = Array.isArray(values) ? values : fallback;
  const selected = new Set(source.map((value) => String(value).toLowerCase()));
  return options.filter((option) => selected.has(option.toLowerCase()));
}

function orderedDurations(values: unknown, fallback: readonly number[]): number[] {
  const source = Array.isArray(values) ? values : fallback;
  const selected = new Set(
    source
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 4 && value <= 30),
  );
  return VIDEO_DURATIONS.filter((duration) => selected.has(duration));
}

export function getVideoModelOptions(config: VideoModelConfig): VideoModelOptions {
  return {
    ratios: orderedStrings(config.ratios, VIDEO_RATIOS.map((option) => option.value), VIDEO_RATIOS.map((option) => option.value)),
    resolutions: orderedStrings(config.resolutions, VIDEO_RESOLUTIONS, LEGACY_VIDEO_RESOLUTIONS),
    durations: orderedDurations(config.durations, LEGACY_VIDEO_DURATIONS),
    allowAudio: config.audio !== false,
  };
}

export function normalizeVideoParamSelection(
  config: VideoModelConfig,
  preferred?: Partial<VideoParamSelection> | null,
): VideoParamSelection {
  const options = getVideoModelOptions(config);
  const ratio = preferred?.ratio && options.ratios.includes(preferred.ratio)
    ? preferred.ratio
    : options.ratios.includes("auto") ? "auto" : options.ratios[0] ?? "auto";
  const preferredResolution = preferred?.resolution?.toUpperCase();
  const resolution = preferredResolution && options.resolutions.includes(preferredResolution)
    ? preferredResolution
    : options.resolutions[0] ?? "480P";
  const duration = preferred?.duration != null && options.durations.includes(Number(preferred.duration))
    ? Number(preferred.duration)
    : options.durations[0] ?? 4;
  const audio = options.allowAudio ? preferred?.audio !== false : false;
  return { ratio, resolution, duration, audio };
}

export function getVideoSecondRate(config: VideoModelConfig, resolution: string, audio: boolean): number | undefined {
  const pricing = config.secondPricing;
  if (!pricing || typeof pricing !== "object") return undefined;
  const key = Object.keys(pricing).find((item) => item.toLowerCase() === resolution.toLowerCase());
  if (!key) return undefined;
  const value = audio ? pricing[key]?.withAudio : pricing[key]?.withoutAudio;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

export function calculateVideoBaseCost(
  config: VideoModelConfig,
  value: Pick<VideoParamSelection, "resolution" | "duration" | "audio">,
): number | undefined {
  const rate = getVideoSecondRate(config, value.resolution, value.audio);
  return rate == null ? undefined : rate * value.duration;
}

export function readRememberedVideoParams(modelId: string): Partial<VideoParamSelection> | null {
  if (typeof window === "undefined" || !modelId) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIDEO_PARAM_MEMORY_KEY) || "{}") as Record<string, Partial<VideoParamSelection>>;
    const value = parsed[modelId];
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function rememberVideoParams(modelId: string, value: VideoParamSelection): void {
  if (typeof window === "undefined" || !modelId) return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIDEO_PARAM_MEMORY_KEY) || "{}") as Record<string, VideoParamSelection>;
    parsed[modelId] = value;
    window.localStorage.setItem(VIDEO_PARAM_MEMORY_KEY, JSON.stringify(parsed));
  } catch {
    // 浏览器禁用存储时仍保留当前会话内状态。
  }
}

export function sameVideoParams(a: VideoParamSelection, b: VideoParamSelection): boolean {
  return a.ratio === b.ratio && a.resolution === b.resolution && a.duration === b.duration && a.audio === b.audio;
}
