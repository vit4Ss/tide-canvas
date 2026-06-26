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
  /** Audit-log filters (g6_logs.go). */
  userId?: string;
  action?: string;
  scene?: string;
  status?: string;
  success?: string;
}

/** API access log (model.AccessLog) — GET /api/admin/logs/access. */
export interface AccessLogVO {
  id: string;
  userId: string;
  method: string;
  path: string;
  query: string;
  status: number;
  latencyMs: number;
  ip: string;
  userAgent: string;
  requestId: string;
  createTime: string;
}

/** Login / auth event (model.LoginLog) — GET /api/admin/logs/login. */
export interface LoginLogVO {
  id: string;
  userId: string;
  account: string;
  /** login | register | logout | login_code */
  action: string;
  /** password | code */
  channel: string;
  /** 0 fail / 1 ok */
  success: number;
  failReason: string;
  ip: string;
  userAgent: string;
  createTime: string;
}

/** Business event (model.BizLog) — GET /api/admin/logs/business. */
export interface BizLogVO {
  id: string;
  userId: string;
  /** checkin | points_adjust | order_create | … */
  action: string;
  summary: string;
  /** decimal string (yuan). */
  amount: string;
  points: number;
  refId: string;
  refType: string;
  operatorId: string;
  detail: string;
  createTime: string;
}

/** Upstream relay model call (model.ModelCallLog) — GET /api/admin/logs/model. */
export interface ModelCallLogVO {
  id: string;
  userId: string;
  /** chat | optimize | image | video */
  scene: string;
  model: string;
  endpoint: string;
  requestBody: string;
  responseBody: string;
  httpStatus: number;
  /** 0 fail / 1 ok */
  success: number;
  errorMsg: string;
  durationMs: number;
  upstreamTaskId: string;
  cost: string;
  createTime: string;
}
