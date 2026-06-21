import { http, toParams } from "@/lib/http";
import type { BannerVO, HomeFeedVO } from "@/types/content";

/**
 * Content API — public reads of promotional/home content. Mirrors
 * tide-canvas-server/internal/handler/content. Both endpoints are public
 * (no auth/session required).
 *
 *   GET /api/home/feed -> HomeFeedVO { banners[], works[], models[] }
 *   GET /api/banners   ?position -> BannerVO[]
 */
export const contentApi = {
  homeFeed: () => http.get<HomeFeedVO>("/api/home/feed"),
  banners: (position?: string) =>
    http.get<BannerVO[]>("/api/banners", position ? toParams({ position }) : undefined),
};
