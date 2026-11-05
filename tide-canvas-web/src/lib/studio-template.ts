import type { StudioTemplate } from "./studio-template-api";
import type { StudioModelVO } from "./market-api";

export function templateInputs(row: Pick<StudioTemplate, "requirements" | "mode">): string {
  const optional = row.requirements.optionalImages?.length || 0;
  const parts = [
    row.requirements.images ? optional ? `${row.requirements.images-optional} 张必填图片 + ${optional} 张选填图片` : `${row.requirements.images} 张图片` : "",
    row.requirements.videos ? `${row.requirements.videos} 段视频` : "",
    row.requirements.audio ? `${row.requirements.audio} 段音频` : "",
  ].filter(Boolean);
  return parts.length
    ? parts.join(" + ")
    : row.mode === "ref"
      ? "至少 1 个参考素材"
      : "无需上传素材";
}

const runtimeMode = (mode: StudioTemplate["mode"]) => mode === "flf" ? "keyframe" : mode === "ref" ? "omni_ref" : mode;
const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/s$/, "");
const includesOption = (options: unknown, value: unknown) => !Array.isArray(options) || !options.length || !normalized(value) || options.some(option => normalized(option) === normalized(value));

/**
 * Keep the public picker focused on models that can plausibly execute the
 * template. The server repeats every check and remains authoritative.
 */
export function templateModelChoices(
  row: Pick<StudioTemplate, "mediaType" | "mode" | "requirements" | "options">,
  models: readonly StudioModelVO[],
): StudioModelVO[] {
  return models.filter(model => {
    if (model.type !== row.mediaType || model.config?.availabilityStatus === "maintenance") return false;
    const config = model.config;
    if (!config) return true;
    if (config.modes?.length && !config.modes.includes(runtimeMode(row.mode))) return false;
    if (!includesOption(config.ratios, row.options.aspectRatio)
      || (row.mediaType === "image" && !includesOption(config.qualities, row.options.quality))
      || (row.mediaType === "video" && !includesOption(config.durations, row.options.duration))) return false;
    if (row.mode === "i2i" && config.maxRefImages && row.requirements.images > config.maxRefImages) return false;
    if (row.mode === "ref") {
      if (row.requirements.images && config.omniRefImageEnabled === false) return false;
      if (row.requirements.videos && config.omniRefVideoEnabled === false) return false;
      if (row.requirements.audio && config.omniRefAudioEnabled === false) return false;
      const limits = config.refLimits || {};
      if ((limits["omniRef.imageCount"] || 0) > 0 && row.requirements.images > limits["omniRef.imageCount"]) return false;
      if ((limits["omniRef.videoCount"] || 0) > 0 && row.requirements.videos > limits["omniRef.videoCount"]) return false;
      if ((limits["omniRef.audioCount"] || 0) > 0 && row.requirements.audio > limits["omniRef.audioCount"]) return false;
    }
    return true;
  });
}
