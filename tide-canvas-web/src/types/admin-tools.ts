// ============================================================================
// Admin AI 工具 (ai_tools) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_tools.go. These rows drive the public /tools/<key>
// pages, the homepage 能力卡 and the 创作台 one-click operations.
//
// Tools are CODE-registered (each row corresponds to a registry handler), so
// there is no create/delete — the admin only configures 启用/文案/生成参数.
// idgen.ID serializes as a quoted decimal string ("123") — hence `id: string`.
// ============================================================================

/** Admin view of an ai_tools row (AdminToolVO). */
export interface AdminToolVO {
  id: string;
  /** URL slug, e.g. "expand" → /tools/expand. Immutable (code contract). */
  key: string;
  /** Registry handler name, e.g. "outpaint". Immutable (code contract). */
  handler: string;
  enabled: boolean;
  /** Has a standalone /tools/<key> page + homepage card. */
  showPage: boolean;
  title: string;
  desc: string;
  /** Server-owned engineered EN instruction; empty = use user input (如局部重绘). */
  presetPrompt: string;
  /** Raw JSON object text; empty = builtin defaults. */
  extraParams: string;
  /** Tool page requires a user-typed description. */
  needPrompt: boolean;
  /** Frontend prefers a 4K-capable model + spreads the extras. */
  hd: boolean;
  /** Glyph char like ⤢ (single character). */
  icon: string;
  /** Three cover hues [h1,h2,h3] (0–360); null when unset/unparsable. */
  cover: number[] | null;
  placeholder: string;
  sortOrder: number;
  /** RFC3339. */
  updateTime: string;
}

/** Partial update; omitted fields are left unchanged (AdminToolUpdateDTO). */
export interface AdminToolUpdateDTO {
  /** Trimmed server-side; may not be updated to empty. */
  title?: string;
  desc?: string;
  presetPrompt?: string;
  /** Must be "" or parse as a JSON object. */
  extraParams?: string;
  needPrompt?: boolean;
  hd?: boolean;
  icon?: string;
  /** null clears; otherwise exactly 3 ints in 0..360. */
  cover?: number[] | null;
  placeholder?: string;
  sortOrder?: number;
  enabled?: boolean;
  showPage?: boolean;
}

/** Toggle availability (AdminToolStatusDTO). */
export interface AdminToolStatusDTO {
  enabled: boolean;
}

/** Reorder payload (AdminToolOrderDTO): ordered ids, index 0 first. */
export interface AdminToolOrderDTO {
  ids: string[];
}
