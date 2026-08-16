// ============================================================================
// Admin 模型市场 (market_model) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_models.go. These admin rows ARE the public 模型市场
// rows (same market_model table), so edits here change the public /models page.
//
// idgen.ID serializes as a quoted decimal string ("123") and nullable FK ids
// (*idgen.ID) serialize as null or a quoted string — hence string / string|null
// below. Decimal prices arrive as strings.
// ============================================================================

/** 模型标签的配色档：hot 红底（热门类）/ new 青底（新品类）/ info 灰字（说明类）。 */
export type ModelBadgeTone = "hot" | "new" | "info";

/** 模型选择列表名称旁的小标签（后台模型管理配置；空 = 不显示）。 */
export interface ModelBadge {
  text: string;
  tone?: ModelBadgeTone;
}

/**
 * Per-model generation settings edited via the admin GUI form and consumed by
 * the 创作台. Stored as a JSON object on the market_model row; the relay sync
 * pre-fills it from the upstream params_schema.
 */
export interface ModelConfig {
  /** 模型选择列表名称旁的标签（热门/新品/权益说明等）；空/未设 = 不显示 */
  badges?: ModelBadge[];
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
  /** 文本模型：允许上传的文件扩展名（小写、不带点，如 ["doc","xlsx","mp4"]）。
   *  空/未设 = 不限制格式；仅当 fileUpload 时有意义 */
  uploadFormats?: string[];
  /** 文本模型：是否作为「AI 优化」主模型（全局唯一，创作台 AI 优化按钮走此模型） */
  aiOptimizePrimary?: boolean;
  /**
   * 视频模型按生成方式的参考素材限制（数量 / 单个大小 MB）。键形如
   * "i2v.imageCount" / "i2v.imageSizeMB" / "keyframe.imageCount" /
   * "omniRef.imageCount" / "omniRef.videoSizeMB" 等；0 或未设 = 不限制。
   */
  refLimits?: Record<string, number>;
  /** Omni reference image support. Unset means supported for legacy configs. */
  omniRefImageEnabled?: boolean;
  /** Omni reference video support. Unset means supported for legacy configs. */
  omniRefVideoEnabled?: boolean;
  /** Omni reference audio support. Unset means supported for legacy configs. */
  omniRefAudioEnabled?: boolean;
  /** image: t2i,i2i · video: t2v,i2v,keyframe,omni_ref · 3d: relay-defined modes */
  modes?: string[];
  ratios?: string[];
  resolutions?: string[];
  qualities?: string[];
  durations?: string[];
  batchOptions?: number[];
  gridOutput?: boolean;
  capabilities?: string[];
  operations?: string[];
  /** points per quality(or duration) × resolution cell; accepts numbers or numeric strings */
  priceMatrix?: Record<string, Record<string, string | number>>;
  /** 旧模型价格矩阵字段；公开模型接口会补 priceMatrix，前端仍保留兼容。 */
  pricing?: Record<string, Record<string, string | number>>;
  /** 视频生成计费方式；缺省/旧数据继续使用时长 × 清晰度矩阵。 */
  videoBillingMode?: "duration" | "per_request";
  /** 视频按次计费时，各输出清晰度的一次生成积分；与时长矩阵并存、互不覆盖。 */
  pricePerRequestByResolution?: Record<string, number | string>;
  /** 视频超分旧版统一每秒积分；仅用于滚动升级兼容。 */
  pricePerSecond?: number | string;
  /** 视频超分按目标分辨率配置的每秒积分。 */
  pricePerSecondByResolution?: Record<string, number | string>;
  /** 视频模型：是否对随请求提交的参考视频按实际时长额外收费。 */
  referenceVideoBillingEnabled?: boolean;
  /** raw upstream price modifiers, kept for reference */
  priceModifiers?: unknown;
  /** complete upstream params_schema, including modality-specific 3D options */
  paramsSchema?: unknown;
  creditCost?: number;
  /** 音频(Suno)：本地音频「上传登记」任务的单次积分；空/0 = 按消耗积分计。
      后端 toNum 兼容数字与数字字符串，输入框直接存字符串。 */
  uploadCost?: number | string;
}

/** Admin list/detail view of a market_model row (AdminModelVO). */
export interface AdminModelVO {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  tags: string;
  /** media category: text | image | video | audio | 3d | upscale */
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
  /** 类型内顺序（小值在前；后台上移/下移维护） */
  sortOrder: number;
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
  /** media category: text | image | video | audio | 3d */
  type?: string;
}

/** Create a market_model row (AdminModelCreateDTO). */
export interface AdminModelCreateDTO {
  name: string;
  description?: string;
  coverUrl?: string;
  tags?: string;
  /** media category: text | image | video | audio | 3d (defaults to image) */
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
  /** media category: text | image | video | audio | 3d */
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

/** One real user call in the 模型状态 view (AdminModelCallVO). */
export interface AdminModelCallVO {
  ok: boolean;
  totalMs: number;
  /** 调用场景：chat | optimize | blog-polish | image | video… */
  scene: string;
  error: string;
  time: string;
}

/** One model card on the 模型状态 page (AdminModelStatusVO)。
    不主动探测（2026-07-13 用户定稿）：全部指标由 model_call_log 里的
    真实用户调用聚合而来。 */
export interface AdminModelStatusVO {
  id: string;
  name: string;
  type: string;
  modelKey: string;
  icon: string;
  enabled: boolean;
  current: AdminModelCallVO | null;
  /** 成功率百分比 0–100；null = 窗口内无调用 */
  avail24h: number | null;
  avail7d: number | null;
  /** 窗口内真实调用次数 */
  calls24h: number;
  calls7d: number;
  /** 旧→新，≤60，驱动状态条 */
  recent: AdminModelCallVO[];
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
  "3d": "3D",
  upscale: "超分",
};

/** Media-category value → label used in the create/edit form 类型 dropdown. */
export const MODEL_TYPE_FORM_LABEL: Record<string, string> = {
  image: "图片生成",
  video: "视频生成",
  text: "文本生成",
  audio: "音频生成",
  "3d": "3D 生成",
  upscale: "视频超分",
};
