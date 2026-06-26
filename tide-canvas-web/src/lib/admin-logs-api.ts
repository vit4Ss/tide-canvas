// ============================================================================
// Admin logs API client — wraps GET /api/admin/logs (paged, level?/module?).
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` first.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  LogVO,
  LogQuery,
  AccessLogVO,
  LoginLogVO,
  BizLogVO,
  ModelCallLogVO,
} from "@/types/admin-logs";

export const adminLogsApi = {
  /** GET /api/admin/logs -> PageData<LogVO> (level? / module? / keyword? filters). */
  list: (query: LogQuery = {}) =>
    http.get<PageData<LogVO>>("/api/admin/logs", toParams(query)),

  /** GET /api/admin/logs/access -> PageData<AccessLogVO> (userId? / status? / keyword?). */
  access: (query: LogQuery = {}) =>
    http.get<PageData<AccessLogVO>>("/api/admin/logs/access", toParams(query)),

  /** GET /api/admin/logs/login -> PageData<LoginLogVO> (userId? / action? / success? / keyword?). */
  login: (query: LogQuery = {}) =>
    http.get<PageData<LoginLogVO>>("/api/admin/logs/login", toParams(query)),

  /** GET /api/admin/logs/business -> PageData<BizLogVO> (userId? / action? / keyword?). */
  business: (query: LogQuery = {}) =>
    http.get<PageData<BizLogVO>>("/api/admin/logs/business", toParams(query)),

  /** GET /api/admin/logs/model -> PageData<ModelCallLogVO> (userId? / scene? / success? / keyword?). */
  model: (query: LogQuery = {}) =>
    http.get<PageData<ModelCallLogVO>>("/api/admin/logs/model", toParams(query)),
};
