// TypeScript shapes for the public 灵感 (inspiration) domain. Mirrors the VOs in
// tide-canvas-server/internal/handler/inspiration/inspiration.go (camelCase JSON;
// ids are strings). Distinct from the 作品广场 (community) domain: 灵感 is curated
// prompts + themes used to spark creation, not user works.

import type { PageQuery } from "@/types/api";

/** A reusable prompt-library card (PromptVO). */
export interface PromptVO {
  id: string;
  /** The prompt text. */
  text: string;
  /** Tags as a JSON-array string (e.g. '["科幻","赛博朋克"]'); parse with promptTags(). */
  tags: string;
  /** How many times this prompt was adopted into the studio. */
  adoptions: number;
  /** Optional cover image URL (empty → gradient fallback). */
  coverUrl: string;
  createTime: string;
}

/** A curated theme / collection card (CollectionVO). */
export interface CollectionVO {
  id: string;
  title: string;
  /** 合集 / 主题 / 提示词. */
  type: string;
  coverUrl: string;
  /** Tags as a JSON-array string. */
  tags: string;
  description: string;
}

/** Query for the prompt list: GET /api/inspiration/prompts. */
export interface PromptQuery extends PageQuery {
  keyword?: string;
  /** "hot" (by adoptions, default) | "new" (latest). */
  sort?: "hot" | "new";
}

/** Adopt-counter response. */
export interface AdoptVO {
  adoptions: number;
}

/** Parse a tags JSON-array string into a string[] (tolerant of bad input). */
export function parseTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const arr = JSON.parse(tags);
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
