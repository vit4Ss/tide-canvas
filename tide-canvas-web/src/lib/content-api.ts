import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  FooterColVO,
  HomeFeedVO,
  HomeFloorLiteVO,
  NotificationVO,
  NotificationQuery,
} from "@/types/content";

/**
 * Content API — public reads of promotional/home content plus the
 * authenticated notification center. Mirrors
 * tide-canvas-server/internal/handler/content.
 *
 *   GET    /api/home/feed                       -> HomeFeedVO { works[], models[] }
 *   GET    /api/site/footer                     -> FooterColVO[]  (后台配置管理 site.footerLinks)
 *   GET    /api/notifications                    -> PageData<NotificationVO>   (auth)
 *   GET    /api/notifications/unread-count       -> { count }                  (auth)
 *   POST   /api/notifications/read-all           -> void                       (auth)
 *   POST   /api/notifications/items/:id/read     -> void                       (auth)
 *   DELETE /api/notifications/items/:id          -> void                       (auth)
 */
export const contentApi = {
  homeFeed: () => http.get<HomeFeedVO>("/api/home/feed"),
  /** 页脚链接列 — 后台「配置管理」可编辑，服务端带出厂默认兜底。 */
  footer: () => http.get<FooterColVO[]>("/api/site/footer"),
  /** 首页楼层 — 后台「首页楼层」的启用/排序/数量驱动首页区块。 */
  floors: () => http.get<HomeFloorLiteVO[]>("/api/site/floors"),
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
