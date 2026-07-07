// ============================================================================
// Admin · 价格管理 (Pricing) API — wraps the real /api/admin endpoints from
// internal/handler/admin/g4_pricing.go using the shared http helper.
//
// Routes:
//   GET    /api/admin/plans            -> AdminPlan[]
//   POST   /api/admin/plans            -> AdminPlan
//   PUT    /api/admin/plans/:id        -> AdminPlan
//   DELETE /api/admin/plans/:id        -> void
//
// 积分包（/api/admin/packages）管理已下线：积分只随套餐发放。
// ============================================================================

import { http } from "@/lib/http";
import type { AdminPlan, AdminPlanUpsertDTO } from "@/types/admin-pricing";

export const adminPricingApi = {
  // ---- plans (公开定价的同源数据) ----
  listPlans: () => http.get<AdminPlan[]>("/api/admin/plans"),
  createPlan: (dto: AdminPlanUpsertDTO) => http.post<AdminPlan>("/api/admin/plans", dto),
  updatePlan: (id: string, dto: AdminPlanUpsertDTO) =>
    http.put<AdminPlan>(`/api/admin/plans/${id}`, dto),
  deletePlan: (id: string) => http.delete<null>(`/api/admin/plans/${id}`),
};
