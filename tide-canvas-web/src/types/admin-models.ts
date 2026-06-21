// ============================================================================
// Admin 模型市场 (market_model) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_models.go. These admin rows ARE the public 模型市场
// rows (same market_model table), so edits here change the public /models page.
//
// idgen.ID serializes as a quoted decimal string ("123") and nullable FK ids
// (*idgen.ID) serialize as null or a quoted string — hence string / string|null
// below. Decimal prices arrive as strings.
// ============================================================================

/** Admin list/detail view of a market_model row (AdminModelVO). */
export interface AdminModelVO {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  tags: string;
  categoryId: string | null;
  aiModelId: string | null;
  authorId: string;
  authorName: string;
  /** decimal as string */
  price: string;
  /** alias of price (points to run) */
  pointCost: string;
  /** 0 待审核 / 1 已上架 / 2 已下架 */
  status: number;
  /** status === 1 */
  enabled: boolean;
  useCount: number;
  /** alias of useCount */
  usage: number;
  likeCount: number;
  createTime: string;
  updateTime: string;
}

/** Paged list filter (AdminModelQuery). */
export interface AdminModelQuery {
  pageNum?: number;
  pageSize?: number;
  /** matches name/description/tags */
  keyword?: string;
  /** 0/1/2 exact match */
  status?: number;
  /** filter by category id */
  categoryId?: string;
}

/** Create a market_model row (AdminModelCreateDTO). */
export interface AdminModelCreateDTO {
  name: string;
  description?: string;
  coverUrl?: string;
  tags?: string;
  categoryId?: string;
  aiModelId?: string;
  authorId?: string;
  price?: string;
  /** alias for price */
  pointCost?: string;
  status?: number;
}

/** Partial update; omitted fields are left unchanged (AdminModelUpdateDTO). */
export interface AdminModelUpdateDTO {
  name?: string;
  description?: string;
  coverUrl?: string;
  tags?: string;
  categoryId?: string;
  aiModelId?: string;
  price?: string;
  pointCost?: string;
  status?: number;
}

/** Toggle publish state (AdminModelStatusDTO). Send status (0/1/2) or enabled. */
export interface AdminModelStatusDTO {
  status?: number;
  enabled?: boolean;
}

/** Read-only generation-registry view of an ai_model (AdminAiModelVO). */
export interface AdminAiModelVO {
  id: string;
  name: string;
  icon: string;
  modelId: string;
  type: string;
  supportedHandlers: string;
  pointCost: number;
  enabled: boolean;
  sortOrder: number;
}

/** Status numeric → label/tone used by the admin table. */
export const MODEL_STATUS_LABEL: Record<number, string> = {
  0: "待审核",
  1: "已上架",
  2: "已下架",
};
