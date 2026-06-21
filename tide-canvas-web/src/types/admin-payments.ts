// ============================================================================
// Admin · 支付管理 (Payments) — TS shapes mirroring the Go admin handler
// VOs/DTOs in internal/handler/admin/g4_payments.go.
//
// idgen.ID → quoted decimal string in JSON, so id fields are TS `string`.
// Pointer ids (*idgen.ID) come through as `string | null`.
// ============================================================================

/** g4OrderUserVO — compact buyer block embedded in an order row. */
export interface AdminOrderUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
}

/** g4OrderVO — admin order-row view (read-only ledger). */
export interface AdminOrder {
  id: string;
  orderNo: string;
  userId: string;
  user: AdminOrderUser;
  /** Order type (e.g. "plan" / "package"). */
  type: string;
  planId: string | null;
  packageId: string | null;
  amount: number;
  payMethod: string;
  transactionId: string;
  /** 0 待支付 / 1 已支付 / 2 已取消 / 3 已退款. */
  status: number;
  /** RFC3339 string, "" when unpaid. */
  payTime: string;
  createTime: string;
}

/** Query for the paged order list. */
export interface AdminOrderQuery {
  pageNum?: number;
  pageSize?: number;
  /** Optional status filter (0..3). Omit for all. */
  status?: number;
}

/** g4PayChannelVO — admin payment-channel row view. */
export interface AdminPayChannel {
  id: string;
  name: string;
  type: string;
  /** Fee rate (e.g. 0.006 for 0.6%). */
  rate: number;
  todayAmount: number;
  callback: string;
  enabled: boolean;
  sortOrder: number;
  createTime: string;
  updateTime: string;
}

/** g4PayChannelUpsertDTO — create/update body for a payment channel. */
export interface AdminPayChannelUpsertDTO {
  name: string;
  type: string;
  rate?: number;
  callback?: string;
  /** Omit to default to true on create / preserve on update. */
  enabled?: boolean;
  sortOrder?: number;
}
