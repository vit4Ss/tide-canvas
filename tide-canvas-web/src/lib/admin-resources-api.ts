// ============================================================================
// Admin resources API client — wraps /api/admin/resources (+ cache/clear).
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` first.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  ResourceVO,
  ResourceCacheClearVO,
  ResourceQuery,
} from "@/types/admin-resources";

export const adminResourcesApi = {
  /** GET /api/admin/resources -> PageData<ResourceVO>. */
  list: (query: ResourceQuery = {}) =>
    http.get<PageData<ResourceVO>>("/api/admin/resources", toParams(query)),

  /** POST /api/admin/resources/cache/clear -> { cleared: true }. */
  clearCache: () =>
    http.post<ResourceCacheClearVO>("/api/admin/resources/cache/clear"),
};
