import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  PlanVO,
  PayChannelVO,
  CreateOrderDTO,
  OrderVO,
  VerifyResult,
} from "@/types/billing";

/**
 * Billing API — public reads of pricing plans and the admin-enabled pay
 * channels (no auth/session required). Mirrors
 * tide-canvas-server/internal/handler/billing. 积分只随套餐发放，单独购买
 * 积分包的通道已下线（管理端 /api/admin/packages 不受影响）。
 */
export const billingApi = {
  plans: () => http.get<PlanVO[]>("/api/billing/plans"),
  /** 可用支付方式 — 由管理后台「支付渠道」开关驱动，空数组 = 支付未开通。 */
  channels: () => http.get<PayChannelVO[]>("/api/billing/channels"),
};

/**
 * Order API — authenticated purchase flow (mirrors billing/register.go).
 *
 * Flow: create() returns an order whose `payUrl` is the epay page-jump cashier
 * URL; the client redirects the browser there. After the user pays and returns,
 * verify() backstops a dropped async notify by querying the gateway and
 * crediting the order idempotently.
 */
export const orderApi = {
  create: (data: CreateOrderDTO) => http.post<OrderVO>("/api/orders", data),
  get: (id: string) => http.get<OrderVO>(`/api/orders/${id}`),
  list: (query: { pageNum?: number; pageSize?: number; status?: number; type?: string }) =>
    http.get<PageData<OrderVO>>("/api/orders", toParams(query)),
  cancel: (id: string) => http.post<void>(`/api/orders/${id}/cancel`),
  verify: (id: string) => http.post<VerifyResult>(`/api/orders/${id}/verify`),
};

/** localStorage key for the order awaiting return-from-cashier verification. */
export const PENDING_ORDER_KEY = "pending_order_id";
