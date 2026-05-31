import type { PageQuery } from "./api";

export interface BlogVO {
  id: number;
  authorId: number;
  authorName: string;
  authorAvatar: string;
  title: string;
  summary: string;
  coverImage: string;
  category: string;
  tags: string;
  pointsRequired: number;
  viewCount: number;
  likeCount: number;
  tipTotal: number;
  liked: boolean;
  purchased: boolean;
  createTime: string;
}

export interface BlogDetailVO extends BlogVO {
  content: string | null;
}

export interface BlogCreateDTO {
  title: string;
  content: string;
  summary?: string;
  coverImage?: string;
  category?: string;
  tags?: string[];
  pointsRequired?: number;
}

export interface BlogUpdateDTO {
  title?: string;
  content?: string;
  summary?: string;
  coverImage?: string;
  category?: string;
  tags?: string[];
  pointsRequired?: number;
  status?: number;
}

export interface BlogTipDTO {
  amount: number;
}

export interface BlogQuery extends PageQuery {
  keyword?: string;
  category?: string;
  authorId?: number;
  free?: boolean;
}
