// API calls for the admin 发现 (discover slots) section — banner rows shared with
// the public home banners. GET returns a PLAIN LIST (not paged). g2_discover.go.

import { http, toParams } from "@/lib/http";
import type { Result } from "@/types/api";
import type {
  DiscoverSlotQuery,
  DiscoverSlotUpsertDTO,
  DiscoverSlotVO,
} from "@/types/admin-discover";

export const adminDiscoverApi = {
  /** GET /api/admin/discover/slots — every status, ordered sort_order asc. */
  listSlots: (query: DiscoverSlotQuery = {}): Promise<Result<DiscoverSlotVO[]>> =>
    http.get<DiscoverSlotVO[]>("/api/admin/discover/slots", toParams(query)),

  createSlot: (body: DiscoverSlotUpsertDTO): Promise<Result<DiscoverSlotVO>> =>
    http.post<DiscoverSlotVO>("/api/admin/discover/slots", body),

  updateSlot: (
    id: string,
    body: DiscoverSlotUpsertDTO,
  ): Promise<Result<DiscoverSlotVO>> =>
    http.put<DiscoverSlotVO>(`/api/admin/discover/slots/${id}`, body),

  deleteSlot: (id: string): Promise<Result<null>> =>
    http.delete<null>(`/api/admin/discover/slots/${id}`),
};
