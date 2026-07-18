"use client";

import { assistantApi } from "@/lib/api";
import { normalizeAssistantPetStyles } from "@/lib/assistant-pet-styles";
import type { AssistantPetStyle } from "@/types/assistant";

export const ASSISTANT_PET_STYLE_STORAGE_KEY = "tc:assistant:petStyleId";
export const ASSISTANT_PET_STYLE_EVENT = "tc:assistant:petStyleChange";

const LEGACY_PET_IMAGE_STORAGE_KEY = "tc:assistant:petStyleImage";

function clearLegacyPetImage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_PET_IMAGE_STORAGE_KEY);
}

export function loadSelectedAssistantPetStyleId(): string | null {
  if (typeof window === "undefined") return null;
  clearLegacyPetImage();
  const value = window.localStorage.getItem(ASSISTANT_PET_STYLE_STORAGE_KEY);
  return value && !value.startsWith("data:image/") ? value : null;
}

export function saveSelectedAssistantPetStyleId(styleId: string | null) {
  if (typeof window === "undefined") return;
  clearLegacyPetImage();
  if (styleId) {
    window.localStorage.setItem(ASSISTANT_PET_STYLE_STORAGE_KEY, styleId);
  } else {
    window.localStorage.removeItem(ASSISTANT_PET_STYLE_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(ASSISTANT_PET_STYLE_EVENT, { detail: { styleId } }));
}

export async function fetchAssistantPetStyles(): Promise<AssistantPetStyle[]> {
  const res = await assistantApi.petStyles();
  if (!res.success) return [];
  return normalizeAssistantPetStyles(res.data);
}
