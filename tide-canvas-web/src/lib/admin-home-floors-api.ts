// ============================================================================
// Admin 首页楼层 API — wraps /api/admin/home/floors. Backend:
// internal/handler/admin/g3_floors.go. The list returns a plain List (not
// paged); all calls return Result<T>.
//
// Callers must `await useAuthStore.getState().ensureSession()` before invoking.
// ============================================================================

import { http } from "@/lib/http";
import type {
  HomeFloorCreateDTO,
  HomeFloorOrderDTO,
  HomeFloorUpdateDTO,
  HomeFloorVO,
} from "@/types/admin-home-floors";

const BASE = "/api/admin/home/floors";

export const adminHomeFloorsApi = {
  /** GET /api/admin/home/floors — ordered by sortOrder. */
  list: () => http.get<HomeFloorVO[]>(BASE),

  /** POST /api/admin/home/floors — create. */
  create: (dto: HomeFloorCreateDTO) => http.post<HomeFloorVO>(BASE, dto),

  /** PUT /api/admin/home/floors/:id — partial update. */
  update: (id: string, dto: HomeFloorUpdateDTO) =>
    http.put<HomeFloorVO>(`${BASE}/${id}`, dto),

  /** DELETE /api/admin/home/floors/:id. */
  remove: (id: string) => http.delete<null>(`${BASE}/${id}`),

  /** PUT /api/admin/home/floors/order — reorder (ids or explicit pairs). */
  reorder: (dto: HomeFloorOrderDTO) => http.put<null>(`${BASE}/order`, dto),
};
