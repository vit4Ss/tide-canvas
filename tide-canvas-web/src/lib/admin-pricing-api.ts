// ============================================================================
// Admin · 价格管理 (Pricing) API — wraps the real /api/admin endpoints from
// internal/handler/admin/g4_pricing.go using the shared http helper.
//
// Routes:
//   GET    /api/admin/plans            -> AdminPlan[]
//   POST   /api/admin/plans            -> AdminPlan
//   PUT    /api/admin/plans/:id        -> AdminPlan
//   DELETE /api/admin/plans/:id        -> void
//   GET    /api/admin/pricing/compare  -> AdminCompareVO（有效值，含出厂兜底）
//   PUT    /api/admin/pricing/compare  -> AdminCompareVO
//
// 积分包（/api/admin/packages）管理已下线：积分只随套餐发放。
// ============================================================================

import { http } from "@/lib/http";
import type {
  AdminCompareVO,
  AdminFaqVO,
  AdminPlan,
  AdminPlanUpsertDTO,
} from "@/types/admin-pricing";
import type { PromoVO } from "@/types/billing";

export const adminPricingApi = {
  // ---- plans (公开定价的同源数据) ----
  listPlans: () => http.get<AdminPlan[]>("/api/admin/plans"),
  createPlan: (dto: AdminPlanUpsertDTO) => http.post<AdminPlan>("/api/admin/plans", dto),
  updatePlan: (id: string, dto: AdminPlanUpsertDTO) =>
    http.put<AdminPlan>(`/api/admin/plans/${id}`, dto),
  deletePlan: (id: string) => http.delete<null>(`/api/admin/plans/${id}`),
  // ---- 方案对比表（行内容；列=真实套餐，公开定价页同源） ----
  getCompare: () => http.get<AdminCompareVO>("/api/admin/pricing/compare"),
  saveCompare: (vo: AdminCompareVO) => http.put<AdminCompareVO>("/api/admin/pricing/compare", vo),
  // ---- 常见问题 FAQ（公开定价页同源） ----
  getFaq: () => http.get<AdminFaqVO>("/api/admin/pricing/faq"),
  saveFaq: (vo: AdminFaqVO) => http.put<AdminFaqVO>("/api/admin/pricing/faq", vo),
  // ---- 限时折扣横幅（公开定价页同源；关闭或到期前端隐藏） ----
  getPromo: () => http.get<PromoVO>("/api/admin/pricing/promo"),
  savePromo: (vo: PromoVO) => http.put<PromoVO>("/api/admin/pricing/promo", vo),
};
