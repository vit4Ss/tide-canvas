import type { StudioModelVO } from "@/lib/market-api";
import type { SkillVO } from "@/types/skill";

const IMAGE_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
type AssetSchema = { "x-asset-types"?: unknown };

function assetSchema(inputSchema: SkillVO["inputSchema"]): AssetSchema | null {
  if (!inputSchema) return null;
  if (typeof inputSchema === "object") return inputSchema as AssetSchema;
  try {
    return JSON.parse(inputSchema) as AssetSchema;
  } catch {
    return null;
  }
}

function configuredFileUpload(model: StudioModelVO): boolean {
  if (model.type !== "text" || !model.config) return false;
  if (model.config.fileUpload) return true;
  const schema = model.config.paramsSchema;
  return !!schema && typeof schema === "object" &&
    (schema as Record<string, unknown>).file_upload === true;
}

export function toolNeedsMediaAnalysisModel(skill: SkillVO | null | undefined): boolean {
  const kinds = assetSchema(skill?.inputSchema)?.["x-asset-types"];
  return Array.isArray(kinds) && kinds.some((kind) => kind === "video" || kind === "audio");
}

export function supportsMediaAnalysis(model: StudioModelVO, requiresVideoFrames: boolean): boolean {
  if (!configuredFileUpload(model)) return false;
  const formats = model.config?.uploadFormats
    ?.map((format) => format.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  return !requiresVideoFrames || !formats?.length || formats.some((format) => IMAGE_FORMATS.has(format));
}

export function preferredMediaAnalysisModel(
  models: readonly StudioModelVO[],
  selected: StudioModelVO | null,
  skill: SkillVO | null | undefined,
): StudioModelVO | null {
  if (!toolNeedsMediaAnalysisModel(skill)) return selected;
  const kinds = assetSchema(skill?.inputSchema)?.["x-asset-types"];
  const requiresVideoFrames = Array.isArray(kinds) && kinds.includes("video");
  if (selected && supportsMediaAnalysis(selected, requiresVideoFrames)) return selected;
  return models.find((model) => supportsMediaAnalysis(model, requiresVideoFrames)) ?? null;
}
