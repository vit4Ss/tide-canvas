// TS shapes for the admin 灵感 (inspiration) endpoints.
// Mirrors g2_inspiration.go: CollectionVO / CollectionUpsertDTO and
// PromptVO / PromptUpsertDTO. ids are quoted-string idgen.IDs (see admin-works.ts).

/* ──────────────────────────────────────────────────────────────────────────
   灵感合集 (collections) — model.Collection rows.
   Type is a free string seeded as 合集 / 主题 / 提示词.
   ──────────────────────────────────────────────────────────────────────── */

export interface CollectionVO {
  id: string;
  title: string;
  type: string;
  coverUrl: string;
  linkedWorks: number;
  sortOrder: number;
  visible: boolean;
  tags: string;
  description: string;
  createTime: string;
  updateTime: string;
}

/**
 * Body for POST/PUT /admin/inspiration/collections (CollectionUpsertDTO).
 * title is required; the optional flags map to nullable pointers on the server,
 * so omit a field to leave it unchanged on update.
 */
export interface CollectionUpsertDTO {
  title: string;
  type?: string;
  coverUrl?: string;
  linkedWorks?: number;
  sortOrder?: number;
  visible?: boolean;
  tags?: string;
  description?: string;
}

/* ──────────────────────────────────────────────────────────────────────────
   提示词库 (prompts) — model.PromptLib rows.
   ──────────────────────────────────────────────────────────────────────── */

export interface PromptVO {
  id: string;
  text: string;
  tags: string;
  adoptions: number;
  coverUrl: string;
  createTime: string;
  updateTime: string;
}

/** Body for POST/PUT /admin/inspiration/prompts (PromptUpsertDTO). text required. */
export interface PromptUpsertDTO {
  text: string;
  tags?: string;
  adoptions?: number;
  coverUrl?: string;
}

/** Shared paged/keyword query (g2PageQuery) for both collections and prompts. */
export interface InspirationQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  /** collections only: 合集 / 主题 / 提示词 */
  type?: string;
}
