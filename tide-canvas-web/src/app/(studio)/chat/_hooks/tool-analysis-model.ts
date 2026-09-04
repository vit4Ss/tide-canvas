import type { StudioModelVO } from "@/lib/market-api";
import type { SkillVO } from "@/types/skill";

const IMAGE_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
type AssetSchema = {
  "x-asset-types"?: unknown;
  required?: unknown;
  properties?: { assets?: { minItems?: unknown } };
};

export interface SkillModelSupport {
  supported: boolean;
  acceptsAssets: boolean;
  reason?: string;
}

export type ToolAssetKind = "image" | "video" | "audio" | "file";
export interface ToolAssetRequirement {
  kinds: ToolAssetKind[];
  required: boolean;
  builtin: boolean;
}

const BUILTIN_TOOL_ASSETS: Readonly<Record<string, Omit<ToolAssetRequirement, "builtin">>> = {
  "生成 PPT": { kinds: ["image", "file"], required: false },
  "生成 XLSX": { kinds: ["image", "file"], required: false },
  "生成 Word": { kinds: ["image", "file"], required: false },
  "生成 Markdown": { kinds: ["image", "file"], required: false },
  "图片分析": { kinds: ["image"], required: true },
  "视频分析": { kinds: ["video"], required: true },
  "音频分析": { kinds: ["audio"], required: true },
  "网页分析": { kinds: [], required: false },
};

function assetSchema(inputSchema: SkillVO["inputSchema"]): AssetSchema | null {
  if (!inputSchema) return null;
  if (typeof inputSchema === "object") return inputSchema as AssetSchema;
  try {
    return JSON.parse(inputSchema) as AssetSchema;
  } catch {
    return null;
  }
}

export function toolAssetRequirement(skill: SkillVO | null | undefined): ToolAssetRequirement {
  const builtin = BUILTIN_TOOL_ASSETS[skill?.title?.trim() || ""];
  if (builtin) return { ...builtin, kinds: [...builtin.kinds], builtin: true };
  const schema = assetSchema(skill?.inputSchema);
  const rawKinds = schema?.["x-asset-types"];
  const kinds = Array.isArray(rawKinds)
    ? rawKinds.filter((kind): kind is ToolAssetKind =>
        kind === "image" || kind === "video" || kind === "audio" || kind === "file")
    : [];
  const required = Array.isArray(schema?.required) && schema.required.includes("assets");
  const minItems = schema?.properties?.assets?.minItems;
  return { kinds, required: required || (typeof minItems === "number" && minItems > 0), builtin: false };
}

export function modelSupportsFileInput(model: StudioModelVO | null | undefined): boolean {
  if (!model) return false;
  if (model.type !== "text" || !model.config) return false;
  if (typeof model.config.fileUpload === "boolean") return model.config.fileUpload;
  const schema = model.config.paramsSchema;
  return !!schema && typeof schema === "object" &&
    (schema as Record<string, unknown>).file_upload === true;
}

export function toolNeedsMediaAnalysisModel(skill: SkillVO | null | undefined): boolean {
  return toolAssetRequirement(skill).kinds.some((kind) => kind === "video" || kind === "audio");
}

export function supportsMediaAnalysis(model: StudioModelVO, requiresVideoFrames: boolean): boolean {
  if (!modelSupportsFileInput(model)) return false;
  const formats = model.config?.uploadFormats
    ?.map((format) => format.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  return !requiresVideoFrames || !formats?.length || formats.some((format) => IMAGE_FORMATS.has(format));
}

export function skillModelSupport(
  skill: SkillVO | null | undefined,
  model: StudioModelVO | null | undefined,
): SkillModelSupport {
  if (!skill) return { supported: true, acceptsAssets: false };
  if (!model) return { supported: false, acceptsAssets: false, reason: "请先选择文本模型" };
  if (model.type !== "text") {
    return { supported: false, acceptsAssets: false, reason: "当前技能需要文本模型" };
  }
  if (skill.modelId && skill.modelId !== model.modelKey && skill.modelId !== model.id) {
    return { supported: false, acceptsAssets: false, reason: "当前模型不在此技能的支持范围内" };
  }

  const requirement = toolAssetRequirement(skill);
  const kinds = requirement.kinds;
  const requiresAssets = requirement.required;
  if (!kinds.length) return { supported: true, acceptsAssets: false };

  const acceptsFiles = modelSupportsFileInput(model);
  const needsVideoFrames = kinds.includes("video");
  const needsVisualInput = needsVideoFrames || (requiresAssets && kinds.length === 1 && kinds[0] === "image");
  const acceptsAssets = acceptsFiles && (!needsVisualInput || supportsMediaAnalysis(model, true));
  if (requiresAssets && !acceptsAssets) {
    return {
      supported: false,
      acceptsAssets: false,
      reason: acceptsFiles
        ? `当前模型不支持此技能所需的${needsVideoFrames ? "关键帧图片" : "图片"}输入`
        : "当前模型未开启文件上传，不支持此技能",
    };
  }
  return { supported: true, acceptsAssets };
}
