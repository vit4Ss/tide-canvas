// ============================================================================
// Admin resources (g5_resources.go) wire types.
//
// Mirrors the backend VO in
//   tide-canvas-server/internal/handler/admin/g5_resources.go
//   GET  /api/admin/resources              -> PageData<ResourceVO>
//   POST /api/admin/resources/cache/clear  -> { cleared: true }
//
// IDs serialize as quoted decimal STRINGS (idgen.ID). size is BYTES (int64).
// updateTime is an RFC3339 string ("" when zero).
// ============================================================================

/** A tracked platform resource (model.AdminResource). */
export interface ResourceVO {
  id: string;
  name: string;
  /** 存储桶 | CDN | 字体库 | 模型权重 | 临时 … */
  type: string;
  /** Size in bytes. */
  size: number;
  /** Reference count. */
  refs: number;
  /** 健康 | 待清理 … */
  status: string;
  /** RFC3339, "" when unset. */
  updateTime: string;
}

/** Result of POST /resources/cache/clear. */
export interface ResourceCacheClearVO {
  cleared: boolean;
}

/** List query (g5PageQuery) for resources. */
export interface ResourceQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
  status?: string;
}
