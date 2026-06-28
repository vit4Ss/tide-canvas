// Community domain API module. Mirrors the existing modules in src/lib/api.ts:
// each call returns Result<T>; paged endpoints return PageData<T>.
//
// Backend (tide-canvas-server/internal/handler/community):
//   GET    /api/community/posts            → PageData<PostVO>   (public read)
//   GET    /api/community/posts/:id        → PostDetailVO       (public read)
//   POST   /api/community/posts/:id/like   → LikeVO             (auth)
//   DELETE /api/community/posts/:id/like   → LikeVO             (auth)

import { http, toParams } from "@/lib/http";
import type { PageData, PageQuery } from "@/types/api";
import type {
  PostVO,
  PostDetailVO,
  LikeVO,
  BookmarkVO,
  CommentVO,
  CommentCreateDTO,
  AuthorProfileVO,
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

  /** Bookmark / 收藏 a post (auth). */
  bookmark: (id: string) =>
    http.post<BookmarkVO>(`/api/community/posts/${id}/bookmark`),

  /** Remove a bookmark (auth). */
  unbookmark: (id: string) =>
    http.delete<BookmarkVO>(`/api/community/posts/${id}/bookmark`),

  /** A post's comments (public read, newest first). */
  comments: (id: string, query?: PageQuery) =>
    http.get<PageData<CommentVO>>(
      `/api/community/posts/${id}/comments`,
      toParams(query ?? {}),
    ),

  /** Post a comment (or reply via parentId). Auth. */
  createComment: (id: string, data: CommentCreateDTO) =>
    http.post<CommentVO>(`/api/community/posts/${id}/comments`, data),

  /** A creator's public profile header. Public read (follow state when authed). */
  authorProfile: (userId: string) =>
    http.get<AuthorProfileVO>(`/api/community/users/${userId}`),

  /** A creator's published works (paged). Public read. */
  authorPosts: (userId: string, query?: PageQuery) =>
    http.get<PageData<PostVO>>(
      `/api/community/users/${userId}/posts`,
      toParams(query ?? {}),
    ),

  /** Follow a user (auth). */
  follow: (userId: string) => http.post<void>(`/api/follow/users/${userId}`),

  /** Unfollow a user (auth). */
  unfollow: (userId: string) => http.delete<void>(`/api/follow/users/${userId}`),
};
