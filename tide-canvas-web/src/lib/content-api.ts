import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  FooterColVO,
  HomeFeedVO,
  HomeFloorLiteVO,
  HomeGlobalVO,
  NotificationVO,
  NotificationQuery,
} from "@/types/content";

/**
 * Content API — public reads of promotional/home content plus the
 * authenticated notification center. Mirrors
 * tide-canvas-server/internal/handler/content.
 *
 *   GET    /api/home/feed                       -> HomeFeedVO { works[], models[] }
 *   GET    /api/home/work-covers                -> string[]
 *   GET    /api/site/footer                     -> FooterColVO[]  (后台配置管理 site.footerLinks)
 *   GET    /api/notifications                    -> PageData<NotificationVO>   (auth)
 *   GET    /api/notifications/unread-count       -> { count }                  (auth)
 *   POST   /api/notifications/read-all           -> void                       (auth)
 *   POST   /api/notifications/items/:id/read     -> void                       (auth)
 *   DELETE /api/notifications/items/:id          -> void                       (auth)
 */
export const contentApi = {
  homeFeed: () => http.get<HomeFeedVO>("/api/home/feed"),
  /** 智能工具旧数据的轻量封面池；只返回公开作品图片地址。 */
  homeWorkCovers: () => http.get<string[]>("/api/home/work-covers"),
  /** 页脚链接列 — 后台「配置管理」可编辑，服务端带出厂默认兜底。 */
  footer: () => http.get<FooterColVO[]>("/api/site/footer"),
  /** 首页楼层 — 后台「首页楼层」的启用/排序/数量驱动首页区块。 */
  floors: () => http.get<HomeFloorLiteVO[]>("/api/site/floors"),
  /** 首页全局配置 — 后台「首页楼层 · 楼层全局配置」的背景流光与首屏 CTA，
   *  服务端带出厂默认兜底。 */
  homeConfig: () => http.get<HomeGlobalVO>("/api/site/home-config"),
};

/** Notification center — all endpoints require an authenticated session. */
export const notificationApi = {
  list: (query: NotificationQuery = {}) =>
    http.get<PageData<NotificationVO>>("/api/notifications", toParams(query)),
  unreadCount: () =>
    http.get<{ count: number }>("/api/notifications/unread-count"),
  readAll: () => http.post<void>("/api/notifications/read-all"),
  readOne: (id: string | number) =>
    http.post<void>(`/api/notifications/items/${id}/read`),
  remove: (id: string | number) =>
    http.delete<void>(`/api/notifications/items/${id}`),
};
