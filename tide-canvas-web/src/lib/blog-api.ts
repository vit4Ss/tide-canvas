import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminBlogPostVO,
  BlogAdminQuery,
  BlogChannelCreateDTO,
  BlogChannelUpdateDTO,
  BlogChannelVO,
  BlogPostCreateDTO,
  BlogPostLiteVO,
  BlogPostUpdateDTO,
  BlogPostVO,
  BlogSyncResultVO,
} from "@/types/blog";

/** 公开读取（前台 /blog） */
export const blogApi = {
  list: (pageNum = 1, pageSize = 12) =>
    http.get<PageData<BlogPostLiteVO>>("/api/blog/posts", { pageNum, pageSize }),

  detail: (id: string) => http.get<BlogPostVO>(`/api/blog/posts/${id}`),
};

/** 后台管理（/admin/blog；JWT + Admin 角色） */
export const adminBlogApi = {
  posts: (query: BlogAdminQuery = {}) =>
    http.get<PageData<AdminBlogPostVO>>("/api/admin/blog/posts", toParams(query)),

  createPost: (body: BlogPostCreateDTO) =>
    http.post<AdminBlogPostVO>("/api/admin/blog/posts", body),

  updatePost: (id: string, body: BlogPostUpdateDTO) =>
    http.put<AdminBlogPostVO>(`/api/admin/blog/posts/${id}`, body),

  removePost: (id: string) => http.delete<null>(`/api/admin/blog/posts/${id}`),

  /** AI 优化：去广告引流/理顺文案，prompt 代码块原样保留；结果回填表单 */
  polishPost: (body: { title: string; summary: string; content: string }) =>
    http.post<{ title: string; summary: string; content: string }>(
      "/api/admin/blog/posts/ai-polish",
      body,
    ),

  channels: () => http.get<BlogChannelVO[]>("/api/admin/blog/channels"),

  createChannel: (body: BlogChannelCreateDTO) =>
    http.post<BlogChannelVO>("/api/admin/blog/channels", body),

  updateChannel: (id: string, body: BlogChannelUpdateDTO) =>
    http.put<BlogChannelVO>(`/api/admin/blog/channels/${id}`, body),

  removeChannel: (id: string) => http.delete<null>(`/api/admin/blog/channels/${id}`),

  syncChannel: (id: string) =>
    http.post<BlogSyncResultVO>(`/api/admin/blog/channels/${id}/sync`),
};
