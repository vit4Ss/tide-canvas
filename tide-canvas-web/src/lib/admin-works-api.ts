// API calls for the admin 作品 (works) section — community_post rows shared with
// the public /explore feed. Built on the shared http helper (returns Result<T>;
// paged lists are PageData<T>). Endpoints from g2_works.go.

import { http, toParams } from "@/lib/http";
import type { PageData, Result } from "@/types/api";
import type {
  AdminWorkQuery,
  AdminWorkStatusDTO,
  AdminWorkVO,
} from "@/types/admin-works";

export const adminWorksApi = {
  /** GET /api/admin/works — paged, all statuses, filterable. */
  list: (query: AdminWorkQuery = {}): Promise<Result<PageData<AdminWorkVO>>> =>
    http.get<PageData<AdminWorkVO>>("/api/admin/works", toParams(query)),

  /** PUT /api/admin/works/:id/status — 上架/下架/审核状态 + optional 精选 toggle. */
  setStatus: (id: string, body: AdminWorkStatusDTO): Promise<Result<AdminWorkVO>> =>
    http.put<AdminWorkVO>(`/api/admin/works/${id}/status`, body),

  /** DELETE /api/admin/works/:id. */
  remove: (id: string): Promise<Result<null>> =>
    http.delete<null>(`/api/admin/works/${id}`),

  /** POST /api/admin/works/sync-covers — 外链封面转存到本站存储(经加速域名上传)。 */
  syncCovers: (): Promise<Result<CoverSyncResult>> =>
    http.post<CoverSyncResult>(`/api/admin/works/sync-covers`),
};

/** 外链封面转存结果(与后端 coverSyncResult 对应)。 */
export interface CoverSyncResult {
  scanned: number;
  synced: number;
  failed: string[];
}
