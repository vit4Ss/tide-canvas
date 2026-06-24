// ============================================================================
// Admin 模型市场 API — wraps /api/admin/models (+ read-only ai-models registry).
// Backend: internal/handler/admin/g3_models.go. All calls return Result<T>;
// the list returns PageData<AdminModelVO>.
//
// Callers must `await useAuthStore.getState().ensureSession()` before invoking
// (admin endpoints require an admin session).
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminAiModelVO,
  AdminAiProviderVO,
  AdminModelCreateDTO,
  AdminModelQuery,
  AdminModelStatusDTO,
  AdminModelUpdateDTO,
  AdminModelVO,
} from "@/types/admin-models";

const BASE = "/api/admin/models";

export const adminModelsApi = {
  /** GET /api/admin/models — paged list. */
  list: (query: AdminModelQuery = {}) =>
    http.get<PageData<AdminModelVO>>(BASE, toParams(query)),

  /** POST /api/admin/models — create (defaults status 1 已上架). */
  create: (dto: AdminModelCreateDTO) => http.post<AdminModelVO>(BASE, dto),

  /**
   * POST /api/admin/models/sync — pull the latest catalog from the upstream relay
   * and upsert it into the model list (add new / update existing by name).
   */
  sync: () =>
    http.post<{ created: number; updated: number; total: number }>(`${BASE}/sync`),

  /** PUT /api/admin/models/:id — partial update. */
  update: (id: string, dto: AdminModelUpdateDTO) =>
    http.put<AdminModelVO>(`${BASE}/${id}`, dto),

  /** PUT /api/admin/models/:id/status — toggle publish state. */
  setStatus: (id: string, dto: AdminModelStatusDTO) =>
    http.put<AdminModelVO>(`${BASE}/${id}/status`, dto),

  /** DELETE /api/admin/models/:id. */
  remove: (id: string) => http.delete<null>(`${BASE}/${id}`),

  /** GET /api/admin/ai-models — read-only generation registry. */
  listAiModels: () => http.get<AdminAiModelVO[]>("/api/admin/ai-models"),

  /** GET /api/admin/ai-providers — read-only provider registry (供应商 dropdown). */
  listAiProviders: () => http.get<AdminAiProviderVO[]>("/api/admin/ai-providers"),
};
