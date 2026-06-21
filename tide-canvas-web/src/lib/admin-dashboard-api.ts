// ============================================================================
// Admin dashboard API client — wraps GET /api/admin/dashboard/{stats,charts}.
//
// Built on the shared http helper (returns Result<T>). Admin pages must call
// `await useAuthStore.getState().ensureSession()` before invoking these so the
// admin session (role 9) exists and AdminOnly passes on the backend.
// ============================================================================

import { http } from "@/lib/http";
import type { AdminChartsVO, AdminStatsVO } from "@/types/admin-dashboard";

export const adminDashboardApi = {
  /** GET /api/admin/dashboard/stats -> AdminStatsVO (aggregate KPI block). */
  stats: () => http.get<AdminStatsVO>("/api/admin/dashboard/stats"),

  /** GET /api/admin/dashboard/charts -> AdminChartsVO (trailing 14-day series). */
  charts: () => http.get<AdminChartsVO>("/api/admin/dashboard/charts"),
};
