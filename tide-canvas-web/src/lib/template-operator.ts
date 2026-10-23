import type { StudioTemplate, StudioTemplateSave } from "./studio-template-api";
import type { ModelConfig } from "../types/admin-models";
import { modelGenerationOptions } from "./model-generation-options.mjs";

export function templateParameterFields(media: "image" | "video", config?: ModelConfig | null) {
  const opts = modelGenerationOptions(config);
  const fields: { key: keyof StudioTemplate["options"]; label: string; values: string[]; numeric?: boolean }[] = [];
  if (opts.ratios.length) fields.push({ key: "aspectRatio", label: "画面比例", values: opts.ratios });
  if (opts.resolutions.length) fields.push({ key: "resolution", label: media === "video" ? "清晰度" : "分辨率", values: opts.resolutions });
  if (media === "image" && opts.qualities.length) fields.push({ key: "quality", label: "质量", values: opts.qualities });
  if (media === "image" && opts.showCount) fields.push({ key: "batchCount", label: "生成数量", values: opts.batchChoices.map(String), numeric: true });
  if (media === "video" && opts.durations.length) fields.push({ key: "duration", label: "视频时长", values: opts.durations.map(v => String(parseFloat(v))), numeric: true });
  return fields;
}

/** Used on an explicit model switch. A fixed video timeline must not shrink to
 * another model's default; retain its duration for visible/server validation. */
export function templateOptionsForModel(options: StudioTemplate["options"], media: "image" | "video", config?: ModelConfig | null): StudioTemplate["options"] {
  const result: StudioTemplate["options"] = {};
  for (const field of templateParameterFields(media, config)) {
    const value = String(options[field.key] ?? "").trim();
    const match = field.values.find(v => v.toLowerCase() === value.toLowerCase());
    if (match) Object.assign(result, { [field.key]: field.numeric ? Number(match) : match });
  }
  if (media === "video" && options.duration && options.duration > 0) result.duration = options.duration;
  return result;
}

/** Persist the defaults actually shown by the editor. The public model API
 * sorts duration choices, so its first item need not be first in the raw DB
 * config. Leaving defaults empty would make quote/generation choose differently. */
export function templateOptionsForRequest(options: StudioTemplate["options"], media: "image" | "video", config?: ModelConfig | null): StudioTemplate["options"] {
  const result: StudioTemplate["options"] = {};
  for (const field of templateParameterFields(media, config)) {
    const raw = options[field.key];
    const value = raw === undefined || raw === "" || raw === 0 ? field.values[0] : raw;
    Object.assign(result, { [field.key]: field.numeric ? Number(value) : String(value) });
  }
  if (media === "video" && options.duration && options.duration > 0) result.duration = options.duration;
  return result;
}

export function copyTemplateDraft(row: StudioTemplate): StudioTemplateSave {
  return {
    kind: row.kind,
    mediaType: row.mediaType,
    title: `${Array.from(row.title).slice(0, 123).join("")}（副本）`,
    description: row.description,
    category: row.category,
    prompt: row.prompt,
    coverUrl: row.coverUrl,
    previewUrl: row.previewUrl,
    authorName: row.authorName,
    inputHint: row.inputHint,
    inputLabels: structuredClone(row.inputLabels || {}),
    mode: row.mode,
    modelKey: row.modelKey,
    requirements: structuredClone(row.requirements),
    options: { ...row.options },
    status: 0,
    sortOrder: row.sortOrder,
  };
}

export function templateCountRange(
  mode: StudioTemplate["mode"],
  kind: "images" | "videos" | "audio",
) {
  if (kind !== "images") return { min: 0, max: mode === "ref" ? 3 : 0 };
  switch (mode) {
    case "t2i":
    case "t2v":
      return { min: 0, max: 0 };
    case "i2v":
      return { min: 1, max: 1 };
    case "flf":
      return { min: 2, max: 2 };
    case "i2i":
      return { min: 1, max: 16 };
    default:
      return { min: 0, max: 16 };
  }
}

// Preserve a loaded recipe's unsupported value until the operator corrects it.
// An explicit model switch is handled separately by templateOptionsForModel.
export function templateSpecChoices(
  value: string | undefined,
  configured: unknown,
): {
  constrained: boolean;
  invalid: boolean;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
} {
  const values = Array.isArray(configured)
    ? configured
        .filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
        .map((item) => item.trim())
    : [];
  const unique = values.filter(
    (item, index) =>
      values.findIndex(
        (other) => other.toLowerCase() === item.toLowerCase(),
      ) === index,
  );
  const current = value?.trim() || "";
  const match = unique.find(
    (item) => item.toLowerCase() === current.toLowerCase(),
  );
  const invalid = !!current && unique.length > 0 && !match;
  return {
    constrained: unique.length > 0,
    invalid,
    value: match || current,
    options: [
      {
        value: "",
        label: unique.length
          ? `使用模型默认值（${unique[0]}）`
          : "使用模型默认值",
      },
      ...unique.map((item) => ({ value: item, label: item })),
      ...(invalid
        ? [
            {
              value: current,
              label: `${current}（不在模型配置中）`,
              disabled: true,
            },
          ]
        : []),
    ],
  };
}
