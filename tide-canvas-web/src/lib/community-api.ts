// Community domain API module. Mirrors the existing modules in src/lib/api.ts:
// each call returns Result<T>; paged endpoints return PageData<T>.
//
// Backend (tide-canvas-server/internal/handler/community):
//   GET    /api/community/posts            → PageData<PostVO>   (public read)
//   GET    /api/community/posts/:id        → PostDetailVO       (public read)
//   POST   /api/community/posts/:id/like   → LikeVO             (auth)
//   DELETE /api/community/posts/:id/like   → LikeVO             (auth)

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  PostVO,
  PostDetailVO,
  LikeVO,
  CommunityPostQuery,
} from "@/types/community";

export const communityApi = {
  /** Community feed. Public read — filters drive the query (cat/type/sort/keyword). */
  list: (query: CommunityPostQuery) =>
    http.get<PageData<PostVO>>("/api/community/posts", toParams(query)),

  /** Full post detail (generation params + comments). Public read. */
  get: (id: string) =>
    http.get<PostDetailVO>(`/api/community/posts/${id}`),

  /** Like a post. Requires an authed session (ensureSession before calling). */
  like: (id: string) =>
    http.post<LikeVO>(`/api/community/posts/${id}/like`),

  /** Unlike a post. Requires an authed session (ensureSession before calling). */
  unlike: (id: string) =>
    http.delete<LikeVO>(`/api/community/posts/${id}/like`),
};
