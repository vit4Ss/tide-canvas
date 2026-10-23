import type { FileVO } from "@/types/file";
import type { PublicStudioTemplate } from "./studio-template-api";

export type TemplateDraftFiles = Record<string, FileVO>;
const TTL = 7 * 24 * 60 * 60 * 1000;
const key = (owner: string, templateId: string) => `flowlight.template.draft.v1.${encodeURIComponent(owner)}.${encodeURIComponent(templateId)}`;
export const templateDraftSignature = (row: Pick<PublicStudioTemplate, "mode" | "requirements" | "inputLabels">) => JSON.stringify([row.mode, row.requirements.images, row.requirements.videos, row.requirements.audio, row.inputLabels || {}, ...(row.requirements.optionalImages?.length ? [row.requirements.optionalImages] : [])]);

export function readTemplateDraft(owner: string, templateId: string, signature: string, storage?: Storage): { files: TemplateDraftFiles; changed?: boolean } {
  if (!owner) return { files: {} };
  try {
    const value = JSON.parse((storage || localStorage).getItem(key(owner, templateId)) || "null");
    if (!value || value.owner !== owner || value.templateId !== templateId || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > TTL) return { files: {} };
    if (value.signature !== signature) return { files: {}, changed: true };
    const files: TemplateDraftFiles = {};
    for (const [slot, raw] of Object.entries(value.files || {}).slice(0, 48)) {
      const file = raw as Partial<FileVO>;
      if (/^(image|video|audio)-\d+$/.test(slot) && typeof file?.id === "string" && /^\d+$/.test(file.id) && typeof file.fileUrl === "string" && /^(https?:\/\/|\/[^/])/i.test(file.fileUrl) && typeof file.originalName === "string") files[slot] = file as FileVO;
    }
    return { files };
  } catch { return { files: {} }; }
}

export function saveTemplateDraft(owner: string, templateId: string, signature: string, files: TemplateDraftFiles, storage?: Storage): boolean {
  if (!owner) return false;
  try {
    const target = storage || localStorage;
    const safe = Object.fromEntries(Object.entries(files).map(([slot, file]) => [slot, {
      id: file.id, ownerId: owner, originalName: file.originalName, fileUrl: file.fileUrl,
      fileSize: file.fileSize, fileType: file.fileType, mimeType: file.mimeType,
      category: file.category, storageType: file.storageType, createTime: file.createTime,
    }]));
    if (!Object.keys(safe).length) { target.removeItem(key(owner, templateId)); return true; }
    const text = JSON.stringify({ owner, templateId, signature, files: safe, updatedAt: Date.now() });
    target.setItem(key(owner, templateId), text);
    return target.getItem(key(owner, templateId)) === text;
  } catch { return false; }
}
