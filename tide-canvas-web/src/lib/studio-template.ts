import type { StudioTemplate } from "./studio-template-api";
import type { StudioModelVO } from "./market-api";
import type {
  SlotData,
  SlotDef,
} from "../components/studio/create-studio/types";

export function withoutTemplateStyle(
  current: string,
  previous?: StudioTemplate | null,
): string {
  const text = current.trim();
  if (previous?.kind !== "style") return text;
  const prefix = previous.prompt.trim();
  if (text === prefix) return "";
  return prefix && text.startsWith(prefix + "\n\n")
    ? text.slice(prefix.length).trim()
    : text;
}

export function templatePrompt(
  current: string,
  next: StudioTemplate,
  previous?: StudioTemplate | null,
): string {
  if (next.kind === "inspiration") return next.prompt.trim();
  const subject = withoutTemplateStyle(current, previous);
  if (subject === next.prompt.trim()) return subject;
  return [next.prompt.trim(), subject].filter(Boolean).join("\n\n");
}

export function templateModelIssue(
  template: StudioTemplate,
  model: StudioModelVO,
): string | null {
  if (model.type !== template.mediaType) return "模型类型与模板不一致";
  const mode =
    ({ flf: "keyframe", ref: "omni_ref" } as Record<string, string>)[
      template.mode
    ] || template.mode;
  if (model.config?.modes?.length && !model.config.modes.includes(mode))
    return "该模型不支持模板的创作模式，请选择兼容模型";
  const req = template.requirements;
  if (template.mode === "ref") {
    if (
      (req.images && model.config?.omniRefImageEnabled === false) ||
      (req.videos && model.config?.omniRefVideoEnabled === false) ||
      (req.audio && model.config?.omniRefAudioEnabled === false)
    )
      return "该模型不支持模板要求的参考素材类型";
  }
  return null;
}

export function templateReferenceIssue(
  template: StudioTemplate,
  slots: readonly SlotDef[],
  data: SlotData,
): string | null {
  const counts = { image: 0, video: 0, audio: 0 };
  for (const slot of slots)
    counts[slot.type] += (data[slot.k] || []).filter(
      (file) => file.url?.trim() && !file.uploading,
    ).length;
  const needs = [
    ["image", template.requirements.images, "张图片"],
    ["video", template.requirements.videos, "段视频"],
    ["audio", template.requirements.audio, "段音频"],
  ] as const;
  const missing = needs
    .filter(([kind, n]) => counts[kind] < n)
    .map(([, n, label]) => `${n} ${label}`);
  return missing.length
    ? `「${template.title}」需要上传至少 ${missing.join("、")}。${template.inputHint || "请使用你自己的素材"}`
    : null;
}

export function remapTemplateReferences(
  data: SlotData,
  oldSlots: readonly SlotDef[],
  nextSlots: readonly SlotDef[],
): { data: SlotData; discarded: number } {
  const grouped: Record<string, SlotData[string]> = {
    image: [],
    video: [],
    audio: [],
  };
  const next: SlotData = {};
  // Preserve semantic slots (especially first/last frame) before redistributing
  // references from a different mode. An existing tail frame must stay a tail.
  const remaining = new Map(
    oldSlots.map((slot) => [slot.k, [...(data[slot.k] || [])]]),
  );
  const preserved = new Set<string>();
  for (const slot of nextSlots) {
    const original = oldSlots.find(
      (old) => old.k === slot.k && old.type === slot.type,
    );
    next[slot.k] = original
      ? remaining.get(original.k)!.splice(0, slot.max)
      : [];
    if (original) preserved.add(original.k);
  }
  let overflow = 0;
  for (const slot of oldSlots) {
    if (preserved.has(slot.k)) overflow += remaining.get(slot.k)!.length;
    else grouped[slot.type].push(...(remaining.get(slot.k) || []));
  }
  for (const slot of nextSlots)
    next[slot.k].push(
      ...grouped[slot.type].splice(
        0,
        Math.max(0, slot.max - next[slot.k].length),
      ),
    );
  const hidden = Object.entries(data)
    .filter(([key]) => !remaining.has(key))
    .reduce((sum, [, files]) => sum + files.length, 0);
  return {
    data: next,
    discarded:
      hidden +
      overflow +
      Object.values(grouped).reduce((sum, files) => sum + files.length, 0),
  };
}

// Return the model's exact option strings, rather than a template spelling
// that the model-change effect would reject and replace with its first option.
export function templateOptions(
  row: StudioTemplate,
  model: StudioModelVO,
): Omit<StudioTemplate["options"], "duration"> & { duration?: string } {
  const pick = (value: string | undefined, options?: string[]) =>
    value
      ? options?.find(
          (option) =>
            option.trim().toLowerCase() === value.trim().toLowerCase(),
        )
      : undefined;
  const duration = row.options.duration
    ? model.config?.durations?.find(
        (value) => Number(value.replace(/s$/i, "")) === row.options.duration,
      )
    : undefined;
  return {
    aspectRatio: pick(row.options.aspectRatio, model.config?.ratios),
    resolution: pick(row.options.resolution, model.config?.resolutions),
    quality: pick(row.options.quality, model.config?.qualities),
    duration,
  };
}

export function templateInputs(row: StudioTemplate): string {
  const parts = [
    row.requirements.images ? `${row.requirements.images} 张图片` : "",
    row.requirements.videos ? `${row.requirements.videos} 段视频` : "",
    row.requirements.audio ? `${row.requirements.audio} 段音频` : "",
  ].filter(Boolean);
  return parts.length
    ? parts.join(" + ")
    : row.mode === "ref"
      ? "至少 1 个参考素材"
      : "一句描述即可开始";
}
