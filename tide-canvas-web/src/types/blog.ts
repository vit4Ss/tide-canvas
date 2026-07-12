// 博客域类型 — 与后端 VO/DTO 一一对应：
// 公开面: internal/handler/content/blog.go
// 后台面: internal/handler/admin/g2_blog.go

/** 文章来源 */
export type BlogSource = "self" | "telegram";

/** 公开列表卡片（无正文） */
export interface BlogPostLiteVO {
  id: string;
  title: string;
  summary: string;
  coverUrl: string;
  source: BlogSource;
  viewCount: number;
  publishedAt: string;
}

/** 公开详情（含 Markdown 正文） */
export interface BlogPostVO extends BlogPostLiteVO {
  content: string;
}

/** 后台文章行（含状态与来源明细） */
export interface AdminBlogPostVO {
  id: string;
  source: BlogSource;
  channelId: string;
  /** telegram 文章的来源频道（频道已删除时仍回填历史名称） */
  channelTitle: string;
  channelUsername: string;
  tgMsgId: number;
  title: string;
  summary: string;
  coverUrl: string;
  content: string;
  status: number; // 0 草稿, 1 已发布
  viewCount: number;
  publishedAt: string;
  createTime: string;
  updateTime: string;
}

/** 后台文章列表筛选（Type 复用为来源 self|telegram；channelId 精确到频道） */
export interface BlogAdminQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  type?: BlogSource | "";
  status?: "" | "0" | "1";
  channelId?: string;
}

/** 批量上架/下架（作用于来源/频道筛选范围） */
export interface BlogBatchStatusDTO {
  status: number; // 0 草稿, 1 已发布
  source?: BlogSource;
  channelId?: string;
}

/** 新建自建文章 */
export interface BlogPostCreateDTO {
  title: string;
  summary?: string;
  coverUrl?: string;
  content?: string;
  status?: number;
}

/** 部分更新（两种来源通用） */
export interface BlogPostUpdateDTO {
  title?: string;
  summary?: string;
  coverUrl?: string;
  content?: string;
  status?: number;
}

/** Telegram 频道源 */
export interface BlogChannelVO {
  id: string;
  username: string;
  title: string;
  enabled: boolean;
  lastMsgId: number;
  lastSyncAt: string;
  postCount: number;
  createTime: string;
}

export interface BlogChannelCreateDTO {
  username: string;
  title?: string;
}

export interface BlogChannelUpdateDTO {
  title?: string;
  enabled?: boolean;
}

/** 单次同步结果 */
export interface BlogSyncResultVO {
  channelTitle: string;
  created: number;
  skippedEmpty: number;
  imageFailed: number;
  /** true = 媒体落在本地存储（OSS 未生效），链接仅本机可见，属坏数据信号 */
  storageLocal: boolean;
}
