import type { PublicStudioTemplate, TemplateUploads } from "./studio-template-api";

export type TemplateSlot = { key: string; kind: "image" | "video" | "audio"; label: string; optional: boolean };
type UploadFile = { id: string };
export function templateUploadSlots(row: Pick<PublicStudioTemplate, "mode" | "requirements" | "inputLabels">): TemplateSlot[] {
  const requirements = { ...row.requirements };
  if (row.mode === "i2i" || row.mode === "i2v") requirements.images = Math.max(1, requirements.images);
  if (row.mode === "flf") requirements.images = 2;
  const flexible = row.mode === "ref" && requirements.images + requirements.videos + requirements.audio === 0;
  return ([['image', 'images', '图片'], ['video', 'videos', '视频'], ['audio', 'audio', '音频']] as const).flatMap(([kind, field, name]) =>
    Array.from({ length: Math.max(0, Math.min(16, flexible ? 1 : requirements[field])) }, (_, i) => ({ key: `${kind}-${i}`, kind, optional: flexible,
      label: row.inputLabels?.[field]?.[i]?.trim() || (row.mode === "flf" && kind === "image" ? i ? "尾帧图片" : "首帧图片" : `${name}${i + 1}`) })),
  );
}
export function templateUploadInput(slots: TemplateSlot[], files: Record<string, UploadFile>): TemplateUploads {
  const ids = (kind: TemplateSlot["kind"]) => slots.filter(slot => slot.kind === kind && files[slot.key]?.id).map(slot => files[slot.key].id);
  return { imageIds: ids("image"), videoIds: ids("video"), audioIds: ids("audio") };
}
export function templateUploadsReady(row: Pick<PublicStudioTemplate, "mode" | "requirements">, slots: TemplateSlot[], files: Record<string, UploadFile>): boolean {
  if (slots.some(slot => !slot.optional && !files[slot.key]?.id)) return false;
  return row.mode !== "ref" || slots.some(slot => !!files[slot.key]?.id);
}

export function templateOutputText(options?: PublicStudioTemplate["options"]): string {
  if (!options) return "规格待确认";
  const quality = options.quality ? ({ high: "高画质", standard: "标准画质", medium: "中等画质", low: "基础画质" }[options.quality] || `画质 ${options.quality}`) : "";
  return [options.resolution, options.aspectRatio ? `比例 ${options.aspectRatio}` : "", options.duration ? `${options.duration} 秒` : "", quality].filter(Boolean).join(" · ") || "使用模型默认规格";
}
