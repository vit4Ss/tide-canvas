import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  BannerVO,
  HomeFeedVO,
  NotificationVO,
  NotificationQuery,
} from "@/types/content";

/**
 * Content API — public reads of promotional/home content plus the
 * authenticated notification center. Mirrors
 * tide-canvas-server/internal/handler/content.
 *
 *   GET    /api/home/feed                       -> HomeFeedVO { banners[], works[], models[] }
 *   GET    /api/banners   ?position             -> BannerVO[]
 *   GET    /api/notifications                    -> PageData<NotificationVO>   (auth)
 *   GET    /api/notifications/unread-count       -> { count }                  (auth)
 *   POST   /api/notifications/read-all           -> void                       (auth)
 *   POST   /api/notifications/items/:id/read     -> void                       (auth)
 *   DELETE /api/notifications/items/:id          -> void                       (auth)
 */
export const contentApi = {
  homeFeed: () => http.get<HomeFeedVO>("/api/home/feed"),
  banners: (position?: string) =>
    http.get<BannerVO[]>("/api/banners", position ? toParams({ position }) : undefined),
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
