import type { AssistantPetStyle } from "@/types/assistant";
import { normalizeAssistantPetSpriteMeta } from "./assistant-pet-sprite";

export const ASSISTANT_PET_STYLES_SETTING_KEY = "canvas.assistant.petStyles";
export const ASSISTANT_PET_STYLE_MAX_BYTES = 2 * 1024 * 1024;
export const ASSISTANT_PET_STYLE_ACCEPT = "image/webp,image/png,image/gif";

const SUPPORTED_MIME_TYPES = new Set(["image/webp", "image/png", "image/gif"]);

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function isSupportedAssistantPetFile(file: File) {
  return SUPPORTED_MIME_TYPES.has(file.type);
}

export function normalizeAssistantPetStyles(value: unknown): AssistantPetStyle[] {
  let source: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      source = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];

  const styles: AssistantPetStyle[] = [];
  source.forEach((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = stringValue(record.id);
    const imageUrl = stringValue(record.imageUrl);
    if (!id || !imageUrl) return;
    styles.push({
      id,
      name: stringValue(record.name) || "助手样式",
      imageUrl,
      enabled: record.enabled !== false,
      isDefault: record.isDefault === true,
      sortOrder: numberValue(record.sortOrder, index + 1),
      createdAt: stringValue(record.createdAt),
      updatedAt: stringValue(record.updatedAt),
      createdBy: stringValue(record.createdBy),
      sprite: normalizeAssistantPetSpriteMeta(record.sprite),
    });
  });
  return styles.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function serializeAssistantPetStyles(styles: AssistantPetStyle[]) {
  return JSON.stringify(
    styles.map((style, index) => ({
      id: style.id,
      name: style.name.trim() || "助手样式",
      imageUrl: style.imageUrl,
      enabled: style.enabled !== false,
      isDefault: Boolean(style.isDefault),
      sortOrder: Number.isFinite(style.sortOrder) ? style.sortOrder : index + 1,
      createdAt: style.createdAt || new Date().toISOString(),
      updatedAt: style.updatedAt || new Date().toISOString(),
      createdBy: style.createdBy || "管理员",
      sprite: normalizeAssistantPetSpriteMeta(style.sprite),
    }))
  );
}

export function ensureAssistantPetDefault(styles: AssistantPetStyle[]) {
  let defaultAssigned = false;
  return styles.map((style) => {
    const enabled = style.enabled !== false;
    const isDefault = enabled && !defaultAssigned && Boolean(style.isDefault);
    if (isDefault) defaultAssigned = true;
    return { ...style, enabled, isDefault };
  }).map((style, index, list) => {
    if (defaultAssigned || !style.enabled) return style;
    const firstEnabledIndex = list.findIndex((item) => item.enabled);
    return index === firstEnabledIndex ? { ...style, isDefault: true } : style;
  });
}

export function resolveAssistantPetStyle(styles: AssistantPetStyle[], selectedId: string | null | undefined) {
  const enabled = styles.filter((style) => style.enabled !== false);
  if (!enabled.length) return null;
  if (selectedId) {
    const selected = enabled.find((style) => style.id === selectedId);
    if (selected) return selected;
  }
  return enabled.find((style) => style.isDefault) ?? enabled[0];
}

export function createAssistantPetStyle(file: File, imageUrl: string, existing: AssistantPetStyle[], sprite?: AssistantPetStyle["sprite"]) {
  const now = new Date().toISOString();
  const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "助手样式";
  const nextOrder = Math.max(0, ...existing.map((style) => Number(style.sortOrder) || 0)) + 10;
  return {
    id: "pet-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    name: baseName,
    imageUrl,
    enabled: true,
    isDefault: existing.every((style) => !style.enabled),
    sortOrder: nextOrder,
    createdAt: now,
    updatedAt: now,
    createdBy: "管理员",
    sprite: normalizeAssistantPetSpriteMeta(sprite),
  } satisfies AssistantPetStyle;
}
