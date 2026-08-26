import type { CanvasNode } from "@/stores/use-canvas-store";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function preservesConceptIdentity(sourceType: string, outputType: string): boolean {
  return outputType === sourceType && (sourceType === "character" || sourceType === "scene");
}

/**
 * 衍生图片节点需要记录本次真正使用的生成配置；角色/场景产物还要继承设定文本，
 * 否则虽然节点类型正确，下游只能拿到参考图而拿不到概念设定。
 */
export function buildImageDerivativeMetadata(input: {
  source: CanvasNode;
  outputType: string;
  modelId?: string;
  generationInput: Record<string, unknown>;
}): Pick<CanvasNode, "generationConfig"> & Partial<Pick<CanvasNode, "prompt">> {
  const { source, outputType, generationInput } = input;
  const modelId = nonEmptyString(input.modelId) ?? nonEmptyString(source.generationConfig?.modelId);
  const quality = nonEmptyString(generationInput.quality) ?? nonEmptyString(source.generationConfig?.quality);
  const resolution = nonEmptyString(generationInput.resolution ?? generationInput.clarity)
    ?? nonEmptyString(source.generationConfig?.resolution);

  return {
    ...(preservesConceptIdentity(source.type, outputType) && source.prompt !== undefined
      ? { prompt: source.prompt }
      : {}),
    generationConfig: {
      ...(modelId ? { modelId } : {}),
      ...(quality ? { quality } : {}),
      ...(resolution ? { resolution } : {}),
      batchCount: 1,
    },
  };
}

/** 保留角色名，同时避免连续生成特写时重复追加同一后缀。 */
export function imageDerivativeTitle(sourceTitle: string | undefined, label: string): string {
  const title = sourceTitle?.trim();
  if (!title || title === label) return label;
  return title.endsWith(` · ${label}`) ? title : `${title} · ${label}`;
}
