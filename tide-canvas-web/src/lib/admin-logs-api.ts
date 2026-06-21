// ============================================================================
// Admin logs API client — wraps GET /api/admin/logs (paged, level?/module?).
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` first.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { LogVO, LogQuery } from "@/types/admin-logs";

export const adminLogsApi = {
  /** GET /api/admin/logs -> PageData<LogVO> (level? / module? / keyword? filters). */
  list: (query: LogQuery = {}) =>
    http.get<PageData<LogVO>>("/api/admin/logs", toParams(query)),
};
