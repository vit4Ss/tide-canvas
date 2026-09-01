import type { CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelVO } from "@/types/ai";

export function supportsVideoReference(
  model: Pick<AiModelVO, "supportedHandlers" | "config">,
): boolean {
  if (model.supportedHandlers?.length && !model.supportedHandlers.includes("reference_to_video")) {
    return false;
  }
  try {
    const config: unknown = model.config ? JSON.parse(model.config) : {};
    return !config || typeof config !== "object" || Array.isArray(config)
      || (config as Record<string, unknown>).omniRefVideoEnabled !== false;
  } catch {
    // Keep legacy/invalid configs on the old permissive path. The service is
    // still authoritative and admin validation prevents new invalid JSON.
    return true;
  }
}

export function selectClipReshootModel(
  models: readonly AiModelVO[],
  preferredModelId: string,
): AiModelVO | undefined {
  return models.find((model) => model.modelId === preferredModelId && supportsVideoReference(model))
    ?? models.find(supportsVideoReference);
}

/**
 * 模型是否支持「原生时间戳级视频编辑」(Seedance 2.5 一类:全片直发 + 按原片
 * 时间码指令局部重生成,无需服务端裁剪/拼接)。严格 opt-in——管理员在模型
 * Config 里显式写 `"timestampVideoEdit": true` 才启用,确保只有实测验证过的
 * 模型走原生管线;其余模型维持 ffmpeg 裁拼路径,行为不变。
 */
export function supportsTimestampVideoEdit(
  model: Pick<AiModelVO, "supportedHandlers" | "config">,
): boolean {
  if (!supportsVideoReference(model)) return false;
  try {
    const config: unknown = model.config ? JSON.parse(model.config) : {};
    return !!config && typeof config === "object" && !Array.isArray(config)
      && (config as Record<string, unknown>).timestampVideoEdit === true;
  } catch {
    return false;
  }
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

/**
 * The relay accepts whole-second generation durations. This is only the
 * temporary replacement clip length; the server later puts that clip back
 * into the source timeline, so it is not the final video's duration.
 */
export function clipReshootProviderDuration(
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  sourceDuration: number,
): number {
  const total = normalizeClipReshootRanges(ranges, sourceDuration)
    .reduce((seconds, range) => seconds + range.end - range.start, 0);
  return Math.max(1, Math.ceil(total - 1e-9));
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

/**
 * ffmpeg 裁拼路径的工程化指令。除基础语义外补两道质量护栏:
 * ① 首尾帧锚定——裁剪片段的第一帧/最后一帧正是与原片的两个接缝画面,要求
 *    输出复现它们,回拼时人物位置/光线才不会跳变;
 * ② 有效时长明示——生成档位(providerSeconds)大于选区总长时,回拼只取前
 *    N 秒、其余丢弃;不告知模型,它会按完整档位编排动作,被掐断在半途。
 */
export function buildClipReshootRangeInstruction(
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  duration: number,
  sourceLabel = "参考视频",
  providerSeconds?: number,
): string {
  const normalized = normalizeClipReshootRanges(ranges, duration);
  const count = normalized.length;
  const selectedSeconds = normalized.reduce((total, range) => total + range.end - range.start, 0);
  let instruction = `重拍${sourceLabel}中的全部画面。该参考视频已按时间轴裁出${count > 1 ? `${count}个` : ""}选中片段；输出仅包含这些片段，并按参考视频顺序连续生成。`
    + `输出第一帧的构图、人物位置与光线必须与参考视频第一帧保持一致，输出最后一帧必须与参考视频最后一帧保持一致，以便与原视频无缝衔接。`;
  if (providerSeconds != null && providerSeconds > selectedSeconds + 0.05) {
    instruction += `全部动作与内容必须在输出的前 ${selectedSeconds.toFixed(1)} 秒内完整呈现并回到收尾画面（其后的画面会被丢弃）。`;
  }
  return instruction;
}

/**
 * 原生时间戳编辑路径的指令:全片作为参考直发,时间码就是原片时间码——参照系
 * 天然正确,无需裁剪、拼接与时间码重映射。用户提示词由调用方以「修改要求:」
 * 标签追加(为空时不追加,避免悬空标签)。
 */
export function buildNativeClipReshootInstruction(
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  duration: number,
  sourceLabel = "参考视频",
): string {
  const normalized = normalizeClipReshootRanges(ranges, duration);
  const spans = normalized
    .map((range) => `${formatClipReshootTime(range.start)}-${formatClipReshootTime(range.end)}`)
    .join("、");
  return `仅重新生成${sourceLabel}中 ${spans} 时间段的画面，其余时间段的画面、时长、运镜与节奏保持完全不变，输出与${sourceLabel}等长的完整视频。`;
}

/**
 * ffmpeg 路径的时间码重映射:用户按原片时间轴写的时间码(如 0:04-0:06),在
 * 模型看到的「裁剪后短片」里指向完全不同的位置——提交前线性映射到裁剪时间轴。
 * 端点落在未选中区间(缝隙)时无法映射,返回明确错误让用户改选区或删时间码;
 * 没写时间码则原样通过。跨越缝隙的时间段按拼接语义映射(缝隙被移除后连续)。
 */
export function remapClipReshootPromptTimecodes(
  prompt: string,
  ranges: ReadonlyArray<Pick<ClipReshootRange, "start" | "end">> | undefined,
  sourceDuration: number,
): { prompt: string; error?: undefined } | { prompt?: undefined; error: string } {
  const normalized = normalizeClipReshootRanges(ranges, sourceDuration);
  const toClipTime = (time: number): number | null => {
    let offset = 0;
    for (const range of normalized) {
      if (time >= range.start - 0.05 && time <= range.end + 0.05) {
        return offset + Math.min(Math.max(time - range.start, 0), range.end - range.start);
      }
      offset += range.end - range.start;
    }
    return null;
  };

  let error: string | null = null;
  const remapped = prompt.replace(clipTimecodeRangePattern(), (raw, startText: string, endText: string) => {
    const start = parseTimecode(startText);
    const end = parseTimecode(endText);
    // 格式问题(秒数≥60 等)与时长无关,留给 validateClipReshootPrompt 统一报错。
    if (start == null || end == null) return raw;
    // 画幅比例等同形文本(与校验同一判别)原样放行,不误判为"落在缝隙里"。
    if (looksLikeNonTimecodeRange(startText, endText, start, end, sourceDuration)) return raw;
    // 顺序错误必须在这里报:本函数持有原片时长语境,能确认它是时间码;放给
    // 下游 validate 的话,其判别基于裁剪后的选区总长,远超选区的倒序真实时间码
    // (如 180s 片选 10s,写"2:30到2:10")会被误判成画幅文本静默放行。
    if (end <= start) {
      error ??= `提示词中的时间段“${raw}”结束时间必须晚于开始时间`;
      return raw;
    }
    const clipStart = toClipTime(start);
    const clipEnd = toClipTime(end);
    if (clipStart == null || clipEnd == null || clipEnd - clipStart < 0.05) {
      error ??= `提示词中的时间段“${raw}”不在时间轴选中的重拍片段内，请调整选区或删除该时间码`;
      return raw;
    }
    return `${formatClipReshootTime(clipStart)}-${formatClipReshootTime(clipEnd)}`;
  });
  if (error) return { error };
  return { prompt: remapped };
}

/** 提示词里「时间码-时间码」的统一识别正则(校验与重映射共用同一来源,防止
 *  两处规则漂移导致"校验通过但没被重映射"的缝隙)。/g 正则有状态,按次新建。 */
const CLIP_TIMECODE_RANGE_SOURCE =
  "(\\d+(?::\\d+){1,2}(?:\\.\\d+)?)\\s*(?:-|–|—|~|～|至|到)\\s*(\\d+(?::\\d+){1,2}(?:\\.\\d+)?)";
const clipTimecodeRangePattern = () => new RegExp(CLIP_TIMECODE_RANGE_SOURCE, "g");

/** 「16:9到9:16」这类画幅比例文本与时间码同形。判别依据:重拍原片只有十几秒,
 *  真实时间码不可能两端都越界一分钟以上——两端都是裸 M:S 且都超过时长+60s 时,
 *  按普通文本放行(校验不拦、重映射不动),不当时间码处理。 */
function looksLikeNonTimecodeRange(
  rawStart: string,
  rawEnd: string,
  start: number,
  end: number,
  sourceDuration?: number,
): boolean {
  if (!sourceDuration || !Number.isFinite(sourceDuration)) return false;
  const bareMinuteSecond = /^\d{1,2}:\d{1,2}$/;
  return bareMinuteSecond.test(rawStart.trim()) && bareMinuteSecond.test(rawEnd.trim())
    && start > sourceDuration + 60 && end > sourceDuration + 60;
}

export function extractClipReshootRanges(
  prompt: string,
  sourceDuration?: number,
): Array<ClipReshootRange | { raw: string; invalid: true }> {
  const ranges: Array<ClipReshootRange | { raw: string; invalid: true }> = [];
  const pattern = clipTimecodeRangePattern();
  for (const match of prompt.matchAll(pattern)) {
    const raw = match[0];
    const start = parseTimecode(match[1]);
    const end = parseTimecode(match[2]);
    if (start == null || end == null) {
      ranges.push({ raw, invalid: true });
      continue;
    }
    if (looksLikeNonTimecodeRange(match[1], match[2], start, end, sourceDuration)) continue;
    ranges.push({ raw, start, end });
  }
  return ranges;
}

/** 没写时间段时允许按普通提示词提交；一旦写了时间段，就要求格式、顺序和视频边界都有效。 */
export function validateClipReshootPrompt(prompt: string, sourceDuration?: number): string | null {
  const ranges = extractClipReshootRanges(prompt, sourceDuration);
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
  const initialRange = {
    start: 0,
    end: Math.min(CLIP_RESHOOT_DEFAULT_SECONDS, actualDuration),
  };
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
      duration: clipReshootProviderDuration([initialRange], actualDuration),
    },
    videoOperation: "clip_reshoot",
    clipReshootSourceId: source.id,
    clipReshootRanges: [initialRange],
    status: "idle",
  };
}
