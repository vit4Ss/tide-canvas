import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  PlanVO,
  PointPackageVO,
  CreateOrderDTO,
  OrderVO,
  VerifyResult,
} from "@/types/billing";

/**
 * Billing API — public reads of pricing plans and point-package bundles.
 * Mirrors tide-canvas-server/internal/handler/billing. Both reads are public
 * (no auth/session required).
 */
export const billingApi = {
  plans: () => http.get<PlanVO[]>("/api/billing/plans"),
  packages: () => http.get<PointPackageVO[]>("/api/billing/packages"),
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
