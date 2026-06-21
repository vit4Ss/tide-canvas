// ============================================================================
// Admin email API client — wraps /api/admin/email/{templates,api-keys}.
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` first.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  EmailTemplateVO,
  EmailTemplateDTO,
  ApiKeyVO,
  ApiKeyDTO,
  EmailQuery,
} from "@/types/admin-email";

export const adminEmailApi = {
  // ── Templates ──────────────────────────────────────────────────────────
  listTemplates: (query: EmailQuery = {}) =>
    http.get<PageData<EmailTemplateVO>>("/api/admin/email/templates", toParams(query)),
  createTemplate: (dto: EmailTemplateDTO) =>
    http.post<EmailTemplateVO>("/api/admin/email/templates", dto),
  updateTemplate: (id: string, dto: EmailTemplateDTO) =>
    http.put<EmailTemplateVO>(`/api/admin/email/templates/${id}`, dto),
  deleteTemplate: (id: string) =>
    http.delete<void>(`/api/admin/email/templates/${id}`),

  // ── API keys ───────────────────────────────────────────────────────────
  listApiKeys: (query: EmailQuery = {}) =>
    http.get<PageData<ApiKeyVO>>("/api/admin/email/api-keys", toParams(query)),
  createApiKey: (dto: ApiKeyDTO) =>
    http.post<ApiKeyVO>("/api/admin/email/api-keys", dto),
  updateApiKey: (id: string, dto: ApiKeyDTO) =>
    http.put<ApiKeyVO>(`/api/admin/email/api-keys/${id}`, dto),
  deleteApiKey: (id: string) =>
    http.delete<void>(`/api/admin/email/api-keys/${id}`),
};
