import { http, toParams } from "./http";
import type { PageData } from "@/types/api";
import type { ModelCategoryVO, MarketModelVO, MarketModelQuery } from "@/types/market";

/**
 * Market (model marketplace) API — /api/market/*.
 *
 *   categories()    GET  /api/market/categories       -> ModelCategoryVO[]      (public)
 *   list(query)     GET  /api/market/models           -> PageData<MarketModelVO> (public)
 *   get(id)         GET  /api/market/models/:id        -> MarketModelVO          (public)
 *   like(id)        POST /api/market/models/:id/like   -> void                   (auth)
 *   use(id)         POST /api/market/models/:id/use    -> void                   (auth)
 *
 * Catalog reads are public (no session). like/use are authed — call
 * useAuthStore.getState().ensureSession() before invoking them.
 */
export const marketApi = {
  categories: () =>
    http.get<ModelCategoryVO[]>("/api/market/categories"),
  list: (query: MarketModelQuery) =>
    http.get<PageData<MarketModelVO>>("/api/market/models", toParams(query)),
  get: (id: string) =>
    http.get<MarketModelVO>(`/api/market/models/${id}`),
  like: (id: string) =>
    http.post<void>(`/api/market/models/${id}/like`),
  use: (id: string) =>
    http.post<void>(`/api/market/models/${id}/use`),
};
