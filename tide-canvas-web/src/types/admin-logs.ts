// ============================================================================
// Admin logs (g5_logs.go) wire types.
//
// Mirrors the backend VO in
//   tide-canvas-server/internal/handler/admin/g5_logs.go
//   GET /api/admin/logs  (level?, module?, keyword?) -> PageData<LogVO>
//
// IDs serialize as quoted decimal STRINGS (idgen.ID). createTime is RFC3339.
// ============================================================================

/** A system / operation log entry (model.SysLog). */
export interface LogVO {
  id: string;
  /** INFO | WARN | ERROR | SECURITY … */
  level: string;
  /** auth | pay | model | works … */
  module: string;
  message: string;
  ip: string;
  operator: string;
  /** RFC3339, "" when unset. */
  createTime: string;
}

/** List query (g5PageQuery) for logs. */
export interface LogQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  level?: string;
  module?: string;
}
