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

function assetSchema(inputSchema: SkillVO["inputSchema"]): AssetSchema | null {
  if (!inputSchema) return null;
  if (typeof inputSchema === "object") return inputSchema as AssetSchema;
  try {
    return JSON.parse(inputSchema) as AssetSchema;
  } catch {
    return null;
  }
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
  const kinds = assetSchema(skill?.inputSchema)?.["x-asset-types"];
  return Array.isArray(kinds) && kinds.some((kind) => kind === "video" || kind === "audio");
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

  const schema = assetSchema(skill.inputSchema);
  const rawKinds = schema?.["x-asset-types"];
  const kinds = Array.isArray(rawKinds)
    ? rawKinds.filter((kind): kind is string => typeof kind === "string")
    : [];
  const required = Array.isArray(schema?.required) && schema.required.includes("assets");
  const minItems = schema?.properties?.assets?.minItems;
  const requiresAssets = required || (typeof minItems === "number" && minItems > 0);
  if (!kinds.length) return { supported: true, acceptsAssets: false };

  const acceptsFiles = modelSupportsFileInput(model);
  const needsVideoFrames = kinds.includes("video");
  const acceptsAssets = acceptsFiles && (!needsVideoFrames || supportsMediaAnalysis(model, true));
  if (requiresAssets && !acceptsAssets) {
    return {
      supported: false,
      acceptsAssets: false,
      reason: acceptsFiles
        ? "当前模型不支持此技能所需的关键帧图片输入"
        : "当前模型未开启文件上传，不支持此技能",
    };
  }
  return { supported: true, acceptsAssets };
}
