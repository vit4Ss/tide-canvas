// ============================================================================
// Admin · 积分管理 (Points) API — wraps the real /api/admin endpoints from
// internal/handler/admin/g4_points.go using the shared http helper.
//
// Routes:（积分规则 rules CRUD 已整链下线 2026-07-12：无业务消费方）
//   GET    /api/admin/points/transactions  -> PageData<AdminPointRecord>
//   POST   /api/admin/points/adjust        -> AdminPointRecord  (changes REAL balance)
//   GET    /api/admin/points/config        -> AdminPointsConfig
//   PUT    /api/admin/points/config        -> AdminPointsConfig
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminPointAdjustDTO,
  AdminPointRecord,
  AdminPointsConfig,
  AdminPointTxQuery,
} from "@/types/admin-points";

export const adminPointsApi = {
  // ---- ledger (read-only, all users) ----
  listTransactions: (query: AdminPointTxQuery = {}) =>
    http.get<PageData<AdminPointRecord>>("/api/admin/points/transactions", toParams(query)),

  // ---- manual adjust (writes user.points + ledger row) ----
  adjust: (dto: AdminPointAdjustDTO) =>
    http.post<AdminPointRecord>("/api/admin/points/adjust", dto),

  // ---- config ----
  getConfig: () => http.get<AdminPointsConfig>("/api/admin/points/config"),
  putConfig: (body: Partial<AdminPointsConfig>) =>
    http.put<AdminPointsConfig>("/api/admin/points/config", body),
};
