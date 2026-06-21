// ============================================================================
// Admin · 支付管理 (Payments) API — wraps the real /api/admin endpoints from
// internal/handler/admin/g4_payments.go using the shared http helper.
//
// Routes:
//   GET    /api/admin/orders             -> PageData<AdminOrder>
//   GET    /api/admin/orders/:id         -> AdminOrder
//   GET    /api/admin/pay/channels       -> AdminPayChannel[]
//   POST   /api/admin/pay/channels       -> AdminPayChannel
//   PUT    /api/admin/pay/channels/:id   -> AdminPayChannel
//   DELETE /api/admin/pay/channels/:id   -> void
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminOrder,
  AdminOrderQuery,
  AdminPayChannel,
  AdminPayChannelUpsertDTO,
} from "@/types/admin-payments";

export const adminPaymentsApi = {
  // ---- orders (read-only ledger, same `order` table as user purchases) ----
  listOrders: (query: AdminOrderQuery = {}) =>
    http.get<PageData<AdminOrder>>("/api/admin/orders", toParams(query)),
  getOrder: (id: string) => http.get<AdminOrder>(`/api/admin/orders/${id}`),

  // ---- pay channels ----
  listChannels: () => http.get<AdminPayChannel[]>("/api/admin/pay/channels"),
  createChannel: (dto: AdminPayChannelUpsertDTO) =>
    http.post<AdminPayChannel>("/api/admin/pay/channels", dto),
  updateChannel: (id: string, dto: AdminPayChannelUpsertDTO) =>
    http.put<AdminPayChannel>(`/api/admin/pay/channels/${id}`, dto),
  deleteChannel: (id: string) => http.delete<null>(`/api/admin/pay/channels/${id}`),
};
