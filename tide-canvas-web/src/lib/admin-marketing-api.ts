// ============================================================================
// Admin marketing API client — wraps /api/admin/marketing/{campaigns,coupons}.
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` before
// invoking these so the admin session (role 9) exists and AdminOnly passes.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  CampaignVO,
  CampaignDTO,
  CouponVO,
  CouponDTO,
  MarketingQuery,
} from "@/types/admin-marketing";

export const adminMarketingApi = {
  // ── Campaigns ────────────────────────────────────────────────────────────
  listCampaigns: (query: MarketingQuery = {}) =>
    http.get<PageData<CampaignVO>>("/api/admin/marketing/campaigns", toParams(query)),
  createCampaign: (dto: CampaignDTO) =>
    http.post<CampaignVO>("/api/admin/marketing/campaigns", dto),
  updateCampaign: (id: string, dto: CampaignDTO) =>
    http.put<CampaignVO>(`/api/admin/marketing/campaigns/${id}`, dto),
  deleteCampaign: (id: string) =>
    http.delete<void>(`/api/admin/marketing/campaigns/${id}`),

  // ── Coupons ──────────────────────────────────────────────────────────────
  listCoupons: (query: MarketingQuery = {}) =>
    http.get<PageData<CouponVO>>("/api/admin/marketing/coupons", toParams(query)),
  createCoupon: (dto: CouponDTO) =>
    http.post<CouponVO>("/api/admin/marketing/coupons", dto),
  updateCoupon: (id: string, dto: CouponDTO) =>
    http.put<CouponVO>(`/api/admin/marketing/coupons/${id}`, dto),
  deleteCoupon: (id: string) =>
    http.delete<void>(`/api/admin/marketing/coupons/${id}`),
};
