// TypeScript shapes for the community domain. Mirrors the backend VOs in
// tide-canvas-server/internal/handler/community/vo.go (camelCase JSON; every id
// field is serialized as a string).

import type { PageQuery } from "@/types/api";

/** Compact author block embedded in a post card (AuthorVO). */
export interface AuthorVO {
  id: string;
  name: string;
  avatar: string;
}

/** Feed-card view of a community post (PostVO). */
export interface PostVO {
  id: string;
  /** "image" | "video" (backend normalizes, defaults to "image"). */
  type: string;
  /** Cover image URL (may be empty → render a mesh-gradient fallback). */
  cover: string;
  /** Thumbnail URL (currently same as cover; may be empty). */
  thumbnail: string;
  title: string;
  /** Category label. */
  cat: string;
  /** Generation model label. */
  model: string;
  author: AuthorVO;
  /** Like count. */
  likes: number;
  /** Whether the current caller has liked this post. */
  liked: boolean;
  /** View count. */
  views: number;
  /** RFC3339 timestamp (or "" for the zero value). */
  createTime: string;
}

/** Full post view: feed card + generation params + comment count (PostDetailVO). */
export interface PostDetailVO extends PostVO {
  prompt: string;
  negPrompt: string;
  steps: number;
  sampler: string;
  cfgScale: number;
  size: string;
  /** Seed is int64 on the backend; JSON-safe as number here. */
  seed: number;
  /** Comment count. */
  comments: number;
  /** Playable video source for video posts (empty for images); cover = poster. */
  videoUrl: string;
  /** Whether the current viewer has bookmarked this post. */
  bookmarked: boolean;
  /** Whether the current viewer follows the author. */
  following: boolean;
}

/** One comment on a post (CommentVO). */
export interface CommentVO {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  author: AuthorVO;
  createTime: string;
}

/** Public creator profile header (AuthorProfileVO). */
export interface AuthorProfileVO {
  id: string;
  name: string;
  avatar: string;
  works: number;
  likes: number;
  followers: number;
  following: number;
  isFollowing: boolean;
  joinedAt: string;
}

/** Toggle-like response (LikeVO). */
export interface LikeVO {
  liked: boolean;
  likeCount: number;
}

/** Toggle-bookmark response (BookmarkVO). */
export interface BookmarkVO {
  bookmarked: boolean;
}

/** Body for POST /api/community/posts/:id/comments. */
export interface CommentCreateDTO {
  content: string;
  /** Optional reply target (omit/"" for a top-level comment). */
  parentId?: string;
}

/** Query for the community feed: GET /api/community/posts. */
export interface CommunityPostQuery extends PageQuery {
  /** Category filter. */
  cat?: string;
  /** Type filter: "image" | "video". */
  type?: string;
  /** Sort order. */
  sort?: "hot" | "new" | "like";
  /** Free-text keyword (title / author / model). */
  keyword?: string;
}
