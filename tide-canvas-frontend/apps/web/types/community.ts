import type { PageQuery } from "./api";

export interface PostVO {
  id: number;
  userId: string;
  nickname: string;
  avatar: string;
  title: string;
  contentPreview: string;
  images: string;
  contentImages: string[];
  category: string;
  tags: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  createTime: string;
}

export interface PostDetailVO extends PostVO {
  content: string;
}

export interface CommentVO {
  id: number;
  userId: string;
  nickname: string;
  avatar: string;
  content: string;
  parentId: number | null;
  likeCount: number;
  createTime: string;
  replies: CommentVO[];
}

export interface PostCreateDTO {
  title: string;
  content: string;
  images?: string[];
  category?: string;
  tags?: string[];
}

export interface PostUpdateDTO {
  title?: string;
  content?: string;
  images?: string[];
  category?: string;
  tags?: string[];
  status?: number;
}

export interface CommentCreateDTO {
  content: string;
  parentId?: number;
}

export interface PostQuery extends PageQuery {
  keyword?: string;
  category?: string;
  userId?: string;
}
