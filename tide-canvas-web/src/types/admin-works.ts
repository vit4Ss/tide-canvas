// TS shapes for the admin 作品 / 灵感 / 发现 (group g2) endpoints.
//
// Field names mirror the backend VOs/DTOs in
//   tide-canvas-server/internal/handler/admin/g2_works.go
//   tide-canvas-server/internal/handler/admin/g2_inspiration.go
//   tide-canvas-server/internal/handler/admin/g2_discover.go
//
// NOTE on ids: idgen.ID marshals as a QUOTED decimal string (e.g. "123") — see
// idgen.MarshalJSON — and these are 64-bit snowflakes that overflow JS numbers,
// so every id here is typed `string` and passed straight back in path params.

/* ──────────────────────────────────────────────────────────────────────────
   作品 (works) — community_post rows, shared with the public /explore feed.
   AdminWorkVO / AdminWorkAuthorVO / AdminWorkStatusDTO from g2_works.go.
   CommunityPost.Status: 0 待审核 / 1 已发布 / 2 已下架.
   ──────────────────────────────────────────────────────────────────────── */

export const WORK_STATUS_PENDING = 0;
export const WORK_STATUS_PUBLISHED = 1;
export const WORK_STATUS_OFFLINE = 2;

export interface AdminWorkAuthorVO {
  id: string;
  name: string;
  avatar: string;
}

export interface AdminWorkVO {
  id: string;
  title: string;
  cover: string;
  /** "image" | "video" (workType() always normalizes to one of these). */
  type: string;
  cat: string;
  model: string;
  tags: string;
  author: AdminWorkAuthorVO;
  likes: number;
  comments: number;
  views: number;
  featured: boolean;
  /** 0 待审核 / 1 已发布 / 2 已下架 */
  status: number;
  statusText: string;
  createTime: string;
  updateTime: string;
}

/** Query for GET /admin/works (AdminWorkQuery). */
export interface AdminWorkQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  /** "image" | "video" */
  type?: string;
  cat?: string;
  /** 0/1/2 — sent as a real filter value (0 is meaningful). */
  status?: number;
  featured?: boolean;
}

/** Body for PUT /admin/works/:id/status (AdminWorkStatusDTO). status required. */
export interface AdminWorkStatusDTO {
  status: number;
  featured?: boolean;
}
