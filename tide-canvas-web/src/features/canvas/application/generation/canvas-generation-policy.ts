import { getImageCardSizeForRatio } from "@/lib/image-card-size";
import type { AiTaskVO } from "@/types/ai";
import type {
  CanvasPendingGeneration,
} from "../../domain/models/canvas-document";

export const CANVAS_GENERATION_POLL_INTERVAL_MS = 2_000;
// 图片上游最长约 6 分钟，结果转存仍可能耗时；UI 预算需覆盖完整链路。
export const CANVAS_IMAGE_POLL_BUDGET_MS = 10 * 60 * 1_000;
// 视频与音频任务明显更慢，超出预算后只降频确认，不能把任务误判为失败。
export const CANVAS_LONG_MEDIA_POLL_BUDGET_MS = 30 * 60 * 1_000;

export function createCanvasGenerationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `canvas-gen-${crypto.randomUUID()}`;
  }
  return `canvas-gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidCanvasTaskId(value: unknown): value is string {
  // idgen IDs 是正数 signed-64-bit 十进制字符串。
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}

export function isValidPendingGeneration(value: unknown): value is CanvasPendingGeneration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<CanvasPendingGeneration>;
  return row.version === 1
    && typeof row.handler === "string" && row.handler.trim() === row.handler && row.handler.length > 0
    && typeof row.modelId === "string" && row.modelId.trim() === row.modelId && row.modelId.length > 0
    && !!row.input && typeof row.input === "object" && !Array.isArray(row.input)
    && typeof row.clientRequestId === "string"
    && row.clientRequestId.trim() === row.clientRequestId
    && row.clientRequestId.length > 0 && row.clientRequestId.length <= 96
    && typeof row.projectId === "string"
    && row.projectId.trim() === row.projectId && row.projectId.length > 0
    && typeof row.createdAt === "number" && Number.isFinite(row.createdAt);
}

function hasGenerationInput(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0
    : typeof value === "string" && value.trim().length > 0;
}

/** 返回可直接展示给用户的前置校验错误；null 表示允许创建付费任务。 */
export function generationInputError(
  handler: string,
  input: Readonly<Record<string, unknown>>,
): string | null {
  const audioAlternative = handler === "text_to_audio" && Boolean(input.lyrics || input.extras);
  if (!hasGenerationInput(input.prompt) && !audioAlternative) return "请先输入提示词";

  const anyImage =
    hasGenerationInput(input.imageList)
    || hasGenerationInput(input.image_urls)
    || hasGenerationInput(input.imageUrls)
    || hasGenerationInput(input.sourceImage)
    || hasGenerationInput(input.imageUrl)
    || hasGenerationInput(input.image_url)
    || hasGenerationInput(input.references);

  switch (handler) {
    case "image_to_image":
      return anyImage ? null : "图片编辑需要至少一张参考图";
    case "image_to_video":
      return anyImage || hasGenerationInput(input.firstFrame) ? null : "图生视频需要一张源图片";
    case "start_end_to_video":
      return hasGenerationInput(input.firstFrame)
        || hasGenerationInput(input.startImageUrl)
        || anyImage
        ? null
        : "首尾帧模式需要上传首帧";
    case "reference_to_video": {
      const anyReference = anyImage
        || hasGenerationInput(input.videoReferences)
        || hasGenerationInput(input.video_urls)
        || hasGenerationInput(input.audioReferences)
        || hasGenerationInput(input.audio_urls);
      return anyReference ? null : "参考生视频需要至少一个参考素材";
    }
    case "text_to_audio": {
      const extras = input.extras;
      if (!extras || typeof extras !== "object" || Array.isArray(extras)) return null;
      const extrasRecord = extras as Record<string, unknown>;
      const task = typeof extrasRecord.task === "string" ? extrasRecord.task : "";
      if (task === "extend" || task === "upload_extend") {
        return hasGenerationInput(extrasRecord.continue_clip_id) ? null : "延长模式需先选择原曲";
      }
      if (task === "cover") {
        return hasGenerationInput(extrasRecord.cover_clip_id) ? null : "翻唱模式需先选择原曲";
      }
      return null;
    }
    default:
      return null;
  }
}

/** 按实际 JSON 传输语义冻结恢复快照，拒绝 File、Blob、Map 等不可持久化值。 */
export function freezeGenerationInput(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  try {
    const frozen: unknown = JSON.parse(JSON.stringify(input));
    return frozen && typeof frozen === "object" && !Array.isArray(frozen)
      ? frozen as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseCanvasTaskMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      const parsed: unknown = JSON.parse(meta);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof meta === "object" && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
}

export function extractCanvasTextResult(task: AiTaskVO): string {
  const meta = parseCanvasTaskMeta(task.resultMeta);
  for (const key of ["text", "content", "answer", "message", "response", "output"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function isValidGenerationResultUrl(value: unknown): value is string {
  return typeof value === "string"
    && (value.startsWith("https://") || value.startsWith("http://") || value.startsWith("data:"));
}

function parseAspectRatio(value: unknown): number | null {
  if (typeof value !== "string" || value === "auto") return null;
  const [width, height] = value.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : null;
}

export function imageSizePatchForAspect(aspectRatio: unknown): Record<string, string | number> {
  const aspect = parseAspectRatio(aspectRatio);
  if (!aspect) return {};
  const ratio = String(aspectRatio);
  const size = getImageCardSizeForRatio(ratio, aspect);
  return {
    height: size.h,
    contentW: size.w,
    contentH: size.h,
    aspectRatio: ratio,
  };
}
