import type { Result } from "@/types/api";
import { ResultCode } from "@/types/api";
import type { AiModelVO } from "@/types/ai";
import { isImageReferenceNodeType } from "@/lib/canvas-node-types";

const BYTES_PER_MB = 1024 * 1024;

export const MAX_SINGLE_UPLOAD_MB = 50;
export const MAX_SINGLE_UPLOAD_BYTES = MAX_SINGLE_UPLOAD_MB * BYTES_PER_MB;

export type ReferenceFileKind = "image" | "video" | "audio" | "file";

export interface UploadLimitOptions {
  maxBytes?: number;
  label?: string;
}

type ModelLike = Pick<AiModelVO, "config"> | string | null | undefined;

function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseConfig(modelOrConfig: ModelLike): Record<string, unknown> {
  const raw = typeof modelOrConfig === "string" ? modelOrConfig : modelOrConfig?.config;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function clampToSingleUploadLimit(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return MAX_SINGLE_UPLOAD_BYTES;
  return Math.min(Math.floor(bytes), MAX_SINGLE_UPLOAD_BYTES);
}

function bytesFromMB(mb: number | undefined): number | undefined {
  return mb == null ? undefined : mb * BYTES_PER_MB;
}

function limitFromCandidates(candidates: unknown[]): number | undefined {
  for (const value of candidates) {
    const mb = positiveNumber(value);
    if (mb != null) return bytesFromMB(mb);
  }
  return undefined;
}

export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function resolveUploadLimitBytes(maxBytes?: number): number {
  return clampToSingleUploadLimit(maxBytes ?? MAX_SINGLE_UPLOAD_BYTES);
}

export function resolveModelReferenceLimitBytes(modelOrConfig: ModelLike, kind: ReferenceFileKind, handler?: string): number {
  const config = parseConfig(modelOrConfig);
  const nested = config.referenceLimits && typeof config.referenceLimits === "object" && !Array.isArray(config.referenceLimits)
    ? config.referenceLimits as Record<string, unknown>
    : {};
  const currentRefLimits = config.refLimits && typeof config.refLimits === "object" && !Array.isArray(config.refLimits)
    ? config.refLimits as Record<string, unknown>
    : {};
  const currentLimitMB = handler === "image_to_image" && kind === "image"
    ? config.maxRefImageSizeMB
    : handler === "image_to_video" && kind === "image"
      ? currentRefLimits["i2v.imageSizeMB"]
      : handler === "start_end_to_video" && kind === "image"
        ? currentRefLimits["keyframe.imageSizeMB"]
        : handler === "reference_to_video"
          ? currentRefLimits[`omniRef.${kind}SizeMB`]
          : !handler && kind === "image"
            ? config.maxRefImageSizeMB
            : undefined;

  const common = [
    config.referenceFileMaxMB,
    config.maxReferenceFileMB,
    nested.fileMB,
    nested.file,
    nested.maxFileMB,
  ];
  const bytes = kind === "video"
    ? limitFromCandidates([
        currentLimitMB,
        config.referenceVideoMaxMB,
        config.maxReferenceVideoMB,
        nested.videoMB,
        nested.video,
        nested.maxVideoMB,
        ...common,
      ])
    : kind === "image"
      ? limitFromCandidates([
          currentLimitMB,
          config.referenceImageMaxMB,
          config.maxReferenceImageMB,
          nested.imageMB,
          nested.image,
          nested.maxImageMB,
          ...common,
        ])
      : kind === "audio"
        ? limitFromCandidates([
            currentLimitMB,
            ...common,
          ])
        : limitFromCandidates([config.maxFileSizeMB, ...common]);

  return clampToSingleUploadLimit(bytes ?? MAX_SINGLE_UPLOAD_BYTES);
}

export function referenceKindFromFile(file: Pick<File, "type">): ReferenceFileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function referenceKindFromMeta(meta: { fileType?: string; mimeType?: string; type?: string }): ReferenceFileKind {
  if (meta.fileType === "image" || meta.mimeType?.startsWith("image/") || isImageReferenceNodeType(meta.type)) return "image";
  if (meta.fileType === "video" || meta.mimeType?.startsWith("video/") || meta.type === "video") return "video";
  if (meta.mimeType?.startsWith("audio/") || meta.type === "audio") return "audio";
  return "file";
}

export function validateKnownFileSize(size: number | undefined, name: string | undefined, options: UploadLimitOptions = {}): string | null {
  if (!Number.isFinite(size) || !size || size <= 0) return null;
  const limit = resolveUploadLimitBytes(options.maxBytes);
  if (size <= limit) return null;
  const label = options.label ?? "文件";
  const displayName = name ? `「${name}」` : label;
  return `${displayName}超过${formatUploadSize(limit)}限制，当前为${formatUploadSize(size)}`;
}

export function validateUploadFileSize(file: File, options: UploadLimitOptions = {}): string | null {
  return validateKnownFileSize(file.size, file.name, { ...options, label: options.label ?? "单文件" });
}

export function fileSizeExceededResult<T>(file: File, options: UploadLimitOptions = {}): Result<T> | null {
  const message = validateUploadFileSize(file, options);
  if (!message) return null;
  return {
    success: false,
    code: ResultCode.FILE_SIZE_EXCEEDED,
    message,
    data: undefined as T,
    timestamp: Date.now(),
  };
}
