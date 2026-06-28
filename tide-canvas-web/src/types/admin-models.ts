// ============================================================================
// Admin 模型市场 (market_model) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_models.go. These admin rows ARE the public 模型市场
// rows (same market_model table), so edits here change the public /models page.
//
// idgen.ID serializes as a quoted decimal string ("123") and nullable FK ids
// (*idgen.ID) serialize as null or a quoted string — hence string / string|null
// below. Decimal prices arrive as strings.
// ============================================================================

/**
 * Per-model generation settings edited via the admin GUI form and consumed by
 * the 创作台. Stored as a JSON object on the market_model row; the relay sync
 * pre-fills it from the upstream params_schema.
 */
export interface ModelConfig {
  provider?: string;
  icon?: string;
  costUsd?: string;
  estSeconds?: number;
  /** 创作台提示词框的默认内容 / 占位 */
  defaultPrompt?: string;
  /** 创作台「灵感提示词」可点击填入的列表 */
  ideas?: string[];
  /** 图生图：最多可上传的参考图张数 */
  maxRefImages?: number;
  /** 图生图：单张参考图大小上限（MB） */
  maxRefImageSizeMB?: number;
  /** 文本模型：是否支持联网搜索 */
  webSearch?: boolean;
  /** 文本模型：是否支持文件上传 */
  fileUpload?: boolean;
  /** 文本模型：最多可上传的文件个数（0 / 未设 = 不限），仅当 fileUpload 时有意义 */
  maxFileCount?: number;
  /** 文本模型：上传文件大小上限（MB），仅当 fileUpload 时有意义 */
  maxFileSizeMB?: number;
  /** 文本模型：是否作为「AI 优化」主模型（全局唯一，创作台 AI 优化按钮走此模型） */
  aiOptimizePrimary?: boolean;
  /**
   * 视频模型按生成方式的参考素材限制（数量 / 单个大小 MB）。键形如
   * "i2v.imageCount" / "i2v.imageSizeMB" / "keyframe.imageCount" /
   * "omniRef.imageCount" / "omniRef.videoSizeMB" 等；0 或未设 = 不限制。
   */
  refLimits?: Record<string, number>;
  /** image: t2i,i2i · video: t2v,i2v,keyframe,omni_ref */
  modes?: string[];
  ratios?: string[];
  resolutions?: string[];
  qualities?: string[];
  durations?: string[];
  batchOptions?: number[];
  gridOutput?: boolean;
  capabilities?: string[];
  operations?: string[];
  /** points per quality(or duration) × resolution cell, as decimal strings */
  priceMatrix?: Record<string, Record<string, string>>;
  /** raw upstream price modifiers, kept for reference */
  priceModifiers?: unknown;
  creditCost?: number;
}

/** Admin list/detail view of a market_model row (AdminModelVO). */
export interface AdminModelVO {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  tags: string;
  /** media category: text | image | video | audio */
  type: string;
  /** upstream model id (模型ID) */
  modelKey: string;
  /** per-model generation settings (null when unset) */
  config: ModelConfig | null;
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
  /** media category: text | image | video | audio */
  type?: string;
}

/** Create a market_model row (AdminModelCreateDTO). */
export interface AdminModelCreateDTO {
  name: string;
  description?: string;
  coverUrl?: string;
  tags?: string;
  /** media category: text | image | video | audio (defaults to image) */
  type?: string;
  modelKey?: string;
  config?: ModelConfig;
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
  /** media category: text | image | video | audio */
  type?: string;
  modelKey?: string;
  config?: ModelConfig;
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

/** Read-only generation-registry view of an ai_provider (供应商 dropdown). */
export interface AdminAiProviderVO {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  status: number;
  priority: number;
  rateLimit: number;
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

/** Media-category value → Chinese label used by the admin table + filter. */
export const MODEL_TYPE_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

/** Media-category value → label used in the create/edit form 类型 dropdown. */
export const MODEL_TYPE_FORM_LABEL: Record<string, string> = {
  image: "图片生成",
  video: "视频生成",
  text: "文本生成",
  audio: "音频生成",
};
