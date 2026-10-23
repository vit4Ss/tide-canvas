import type { AiModelVO, AiTaskVO } from "../types/ai";
import type { ModelConfig } from "../types/admin-models";
import type { StudioTemplateSave } from "./studio-template-api";

export function coverModelConfig(model: AiModelVO): ModelConfig {
  try { const value = JSON.parse(model.config || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export function templateCoverModels(models: AiModelVO[]): AiModelVO[] {
  return models.filter(model => {
    const cfg = coverModelConfig(model);
    return model.type === "image" && !!model.modelId && cfg.availabilityStatus !== "maintenance"
      && (!model.supportedHandlers?.length || model.supportedHandlers.includes("text_to_image"))
      && (!cfg.modes?.length || cfg.modes.includes("t2i"));
  }).sort((a,b) => Number(coverModelConfig(b).imagePrimary === true) - Number(coverModelConfig(a).imagePrimary === true));
}

export function templateCoverInput(model: AiModelVO, prompt: string): Record<string, unknown> {
  const cfg = coverModelConfig(model);
  const values = (items: unknown): string[] => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string" && !!item.trim()).map(item => item.trim()) : [];
  const ratios = values(cfg.ratios);
  const ratio = ratios.includes("16:9") ? "16:9" : ratios[0];
  const resolution = values(cfg.resolutions)[0], quality = values(cfg.qualities)[0];
  return { prompt: prompt.trim(), batchCount: 1, ...(ratio ? {aspectRatio: ratio} : {}), ...(resolution ? {resolution} : {}), ...(quality ? {quality} : {}) };
}

/** Build an illustration brief from public presentation text, never copy the
 * private execution recipe, image placeholders or user-upload requirements. */
export function buildTemplateCoverPrompt(row: Pick<StudioTemplateSave, "title" | "description" | "category">): string {
  const clip = (value: string, length: number) => Array.from(value.trim()).slice(0,length).join("");
  return `为创作模板「${clip(row.title,128) || "未命名模板"}」生成一张商业摄影风格的封面示意图。
主题分类：${clip(row.category,64) || "创意影像"}。
内容介绍：${clip(row.description,512) || "围绕模板标题表现清晰的主体与场景"}。
只输出一张完整静态图片，主体突出、光线自然、构图清晰，适合在模板列表中展示。以与主题相关的场景、物品或虚构成年人表达用途，不把视频时长画进图中，不使用多格分镜或界面截图。不要生成文字、数字、店名、品牌标志、水印、地址、电话、价格或资质标识。封面仅为创意示意，不宣称是实际门店或已经生成的视频画面。`;
}

export function templateCoverResult(task: AiTaskVO): string {
  const safe = (url: unknown): url is string => typeof url === "string" && /^(https?:\/\/|\/[^/])/i.test(url.trim());
  if (safe(task.resultUrl)) return task.resultUrl.trim();
  let meta = task.resultMeta;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { return ""; } }
  if (meta && typeof meta === "object" && Array.isArray(meta.urls)) return meta.urls.find(safe)?.trim() || "";
  return "";
}
