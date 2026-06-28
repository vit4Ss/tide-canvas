// Public 灵感 (inspiration) API module — curated prompts + theme collections.
// Mirrors src/lib/community-api.ts conventions: each call returns Result<T>;
// paged endpoints return PageData<T>. All reads are public (no session needed);
// adopt is a public counter bump called when a user 套用 a prompt.
//
// Backend (tide-canvas-server/internal/handler/inspiration):
//   GET  /api/inspiration/prompts            → PageData<PromptVO>
//   GET  /api/inspiration/collections        → PageData<CollectionVO>
//   POST /api/inspiration/prompts/:id/adopt  → AdoptVO

import { http, toParams } from "@/lib/http";
import type { PageData, PageQuery } from "@/types/api";
import type { PromptVO, CollectionVO, PromptQuery, AdoptVO } from "@/types/inspiration";

export const inspirationApi = {
  /** Curated prompt library (public). sort: hot (adoptions) | new. */
  prompts: (query: PromptQuery) =>
    http.get<PageData<PromptVO>>("/api/inspiration/prompts", toParams(query)),

  /** Curated theme collections (public, visible only). */
  collections: (query?: PageQuery) =>
    http.get<PageData<CollectionVO>>("/api/inspiration/collections", toParams(query ?? {})),

  /** Bump a prompt's adoption counter when the user applies it to the studio. */
  adopt: (id: string) => http.post<AdoptVO>(`/api/inspiration/prompts/${id}/adopt`),
};
