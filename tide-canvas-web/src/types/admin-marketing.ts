// ============================================================================
// Admin marketing (g5_marketing.go) wire types.
//
// Mirrors the backend VO/DTO in
//   tide-canvas-server/internal/handler/admin/g5_marketing.go
//   GET    /api/admin/marketing/campaigns        -> PageData<CampaignVO>
//   POST   /api/admin/marketing/campaigns        CampaignDTO -> CampaignVO
//   PUT    /api/admin/marketing/campaigns/:id     CampaignDTO -> CampaignVO
//   DELETE /api/admin/marketing/campaigns/:id     -> void
//   GET    /api/admin/marketing/coupons          -> PageData<CouponVO>
//   POST   /api/admin/marketing/coupons          CouponDTO -> CouponVO
//   PUT    /api/admin/marketing/coupons/:id       CouponDTO -> CouponVO
//   DELETE /api/admin/marketing/coupons/:id       -> void
//
// IDs serialize as quoted decimal STRINGS (idgen.ID). Times are RFC3339 strings
// (empty "" when zero). Coupon.value is a decimal STRING (e.g. "20").
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

/** A coupon / redemption code (model.Coupon). */
export interface CouponVO {
  id: string;
  code: string;
  type: string;
  /** Decimal string, e.g. "20". */
  value: string;
  startTime: string;
  endTime: string;
  used: number;
  limit: number;
  /** active | inactive … */
  status: string;
}

/** Create/update body for a coupon. */
export interface CouponDTO {
  code: string;
  type: string;
  /** Decimal string. */
  value?: string;
  startTime?: string;
  endTime?: string;
  used?: number;
  limit?: number;
  status?: string;
}

/** Shared list query (g5PageQuery) for campaigns / coupons. */
export interface MarketingQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  type?: string;
}
