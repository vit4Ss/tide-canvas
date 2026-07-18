// ============================================================================
// Admin · 积分管理 (Points) — TS shapes mirroring the Go admin handler
// VOs/DTOs in internal/handler/admin/g4_points.go.
//
// idgen.ID → quoted decimal string in JSON, so id fields are TS `string`.
// ============================================================================

import type { AdminOrderUser } from "./admin-payments";

// （积分规则 AdminPointRule / AdminPointRuleUpsertDTO 已随 point_rule 整链
//   下线 2026-07-12：无任何业务消费方。）

/** g4PointRecordVO — one ledger row, enriched with the owning user block. */
export interface AdminPointRecord {
  id: string;
  userId: string;
  user: AdminOrderUser;
  changeType: string;
  amount: number;
  balance: number;
  remark: string;
  refId: string | null;
  createTime: string;
}

/** Query for the paged point ledger. */
export interface AdminPointTxQuery {
  pageNum?: number;
  pageSize?: number;
  /** Filter by owning user id. */
  userId?: string;
  /** Filter by change type (e.g. "adjust"). */
  changeType?: string;
}

/** g4PointAdjustDTO — manual balance-adjustment body (amount may be +/-). */
export interface AdminPointAdjustDTO {
  userId: string;
  amount: number;
  remark?: string;
}

/**
 * Points config — a flat key→value map. The backend exposes exactly these keys
 * (see g4PointsConfigKeys); GET returns each (empty string if unset), PUT
 * upserts only the keys present in the body.
 */
export interface AdminPointsConfig {
  "points.checkinDaily": string;
  /** 每月签到积分上限；空/0 = 不限制 */
  "points.checkinMonthlyCap": string;
  "points.inviteReward": string;
  "points.signupBonus": string;
}

/** The exact config keys the backend persists.
 *（points.exchangeRate 已随「积分只随套餐发放」定稿整链下线，2026-07-10。）*/
export const POINTS_CONFIG_KEYS = [
  "points.checkinDaily",
  "points.checkinMonthlyCap",
  "points.inviteReward",
  "points.signupBonus",
] as const;
