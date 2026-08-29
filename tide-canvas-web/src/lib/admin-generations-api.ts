// ============================================================================
// 生成记录 API client — GET /api/admin/generations(+ /:id 详情)。
// 先 `await useAuthStore.getState().ensureSession()` 再调用(与其它 admin 页同)。
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { GenerationDetailVO, GenerationQuery, GenerationRowVO } from "@/types/admin-generations";

export const adminGenerationsApi = {
  /** GET /api/admin/generations -> PageData<GenerationRowVO> */
  list: (query: GenerationQuery = {}) =>
    http.get<PageData<GenerationRowVO>>("/api/admin/generations", toParams(query)),

  /** GET /api/admin/generations/:id -> GenerationDetailVO */
  detail: (id: string) => http.get<GenerationDetailVO>(`/api/admin/generations/${id}`),
  /** POST /api/admin/generations/:id/refund -> GenerationDetailVO */
  refund: (id: string) => http.post<GenerationDetailVO>(`/api/admin/generations/${id}/refund`),
};
