// ============================================================================
// Admin marketing (g5_marketing.go) wire types.
//
// Mirrors the backend VO/DTO in
//   tide-canvas-server/internal/handler/admin/g5_marketing.go
//   GET    /api/admin/marketing/campaigns        -> PageData<CampaignVO>
//   POST   /api/admin/marketing/campaigns        CampaignDTO -> CampaignVO
//   PUT    /api/admin/marketing/campaigns/:id     CampaignDTO -> CampaignVO
//   DELETE /api/admin/marketing/campaigns/:id     -> void
//
//（优惠券类型已下线：产品没有优惠券体系，2026-07-09 用户拍板。）
// IDs serialize as quoted decimal STRINGS (idgen.ID). Times are RFC3339 strings
// (empty "" when zero).
// ============================================================================

/** A marketing campaign (model.Campaign). */
export interface CampaignVO {
  id: string;
  name: string;
  type: string;
  /** 力度 / 面额 free-text, e.g. "-42%". */
  strength: string;
  /** RFC3339, "" when unset. */
  startTime: string;
  /** RFC3339, "" when unset. */
  endTime: string;
  used: number;
  limit: number;
  /** draft | active | paused | ended … */
  status: string;
  audience: string;
  channels: string;
}

/** Create/update body for a campaign. */
export interface CampaignDTO {
  name: string;
  type: string;
  strength?: string;
  /** RFC3339 / "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD". */
  startTime?: string;
  endTime?: string;
  used?: number;
  limit?: number;
  status?: string;
  audience?: string;
  channels?: string;
}

/** Shared list query (g5PageQuery) for campaigns. */
export interface MarketingQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  type?: string;
}
