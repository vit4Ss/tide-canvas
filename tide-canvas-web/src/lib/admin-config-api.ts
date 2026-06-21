// ============================================================================
// Admin config API client — wraps GET/PUT /api/admin/config.
//
// Built on the shared http helper (returns Result<T>). Admin pages must call
// `await useAuthStore.getState().ensureSession()` first. PUT upserts the given
// items by configKey and returns the full reloaded config list.
// ============================================================================

import { http } from "@/lib/http";
import type { ConfigVO, ConfigItemDTO } from "@/types/admin-config";

export const adminConfigApi = {
  /** GET /api/admin/config -> ConfigVO[]. */
  list: () => http.get<ConfigVO[]>("/api/admin/config"),

  /** PUT /api/admin/config { items } -> ConfigVO[] (full reloaded list). */
  save: (items: ConfigItemDTO[]) =>
    http.put<ConfigVO[]>("/api/admin/config", { items }),
};
