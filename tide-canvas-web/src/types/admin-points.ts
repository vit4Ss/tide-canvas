// ============================================================================
// Admin · 积分管理 (Points) — TS shapes mirroring the Go admin handler
// VOs/DTOs in internal/handler/admin/g4_points.go.
//
// idgen.ID → quoted decimal string in JSON, so id fields are TS `string`.
// ============================================================================

import type { AdminOrderUser } from "./admin-payments";

/** g4PointRuleVO — admin point-rule row view. */
export interface AdminPointRule {
  id: string;
  name: string;
  scene: string;
  /** Consume (negative) / grant (positive) amount. */
  amount: number;
  trigger: string;
  enabled: boolean;
  createTime: string;
  updateTime: string;
}

/** g4PointRuleUpsertDTO — create/update body for a point rule. */
export interface AdminPointRuleUpsertDTO {
  name: string;
  scene: string;
  amount?: number;
  trigger?: string;
  /** Omit to default to true on create / preserve on update. */
  enabled?: boolean;
}

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
  "points.inviteReward": string;
  "points.signupBonus": string;
  "points.exchangeRate": string;
}

/** The exact config keys the backend persists. */
export const POINTS_CONFIG_KEYS = [
  "points.checkinDaily",
  "points.inviteReward",
  "points.signupBonus",
  "points.exchangeRate",
] as const;
