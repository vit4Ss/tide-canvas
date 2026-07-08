// ============================================================================
// Admin marketing API client — wraps /api/admin/marketing/campaigns.
//（优惠券接口已下线：产品没有优惠券体系，2026-07-09 用户拍板。）
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` before
// invoking these so the admin session (role 9) exists and AdminOnly passes.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { CampaignVO, CampaignDTO, MarketingQuery } from "@/types/admin-marketing";

export const adminMarketingApi = {
  listCampaigns: (query: MarketingQuery = {}) =>
    http.get<PageData<CampaignVO>>("/api/admin/marketing/campaigns", toParams(query)),
  createCampaign: (dto: CampaignDTO) =>
    http.post<CampaignVO>("/api/admin/marketing/campaigns", dto),
  updateCampaign: (id: string, dto: CampaignDTO) =>
    http.put<CampaignVO>(`/api/admin/marketing/campaigns/${id}`, dto),
  deleteCampaign: (id: string) =>
    http.delete<void>(`/api/admin/marketing/campaigns/${id}`),
};
