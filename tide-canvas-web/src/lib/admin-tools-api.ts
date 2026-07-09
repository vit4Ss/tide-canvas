// ============================================================================
// Admin AI 工具 API — wraps /api/admin/tools. Backend:
// internal/handler/admin/g3_tools.go. The list returns a plain List (not
// paged); all calls return Result<T>.
//
// No create/delete: tools correspond to code-registered handlers（代码注册能力，
// 配置决定策略）— the admin only edits copy/switches/params and order.
//
// Callers must `await useAuthStore.getState().ensureSession()` before invoking.
// ============================================================================

import { http } from "@/lib/http";
import type {
  AdminToolOrderDTO,
  AdminToolStatusDTO,
  AdminToolUpdateDTO,
  AdminToolVO,
} from "@/types/admin-tools";

const BASE = "/api/admin/tools";

export const adminToolsApi = {
  /** GET /api/admin/tools — ordered by sortOrder, then createTime. */
  list: () => http.get<AdminToolVO[]>(BASE),

  /** PUT /api/admin/tools/:id — partial update. */
  update: (id: string, dto: AdminToolUpdateDTO) =>
    http.put<AdminToolVO>(`${BASE}/${id}`, dto),

  /** PUT /api/admin/tools/:id/status — toggle availability. */
  setStatus: (id: string, dto: AdminToolStatusDTO) =>
    http.put<AdminToolVO>(`${BASE}/${id}/status`, dto),

  /** PUT /api/admin/tools/order — reorder (ordered ids). */
  reorder: (dto: AdminToolOrderDTO) => http.put<null>(`${BASE}/order`, dto),
};
