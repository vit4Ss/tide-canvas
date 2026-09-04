import { http } from "@/lib/http";

export type SocialPlatform =
  | "douyin"
  | "bilibili"
  | "xiaohongshu"
  | "youtube"
  | "tiktok"
  | "kuaishou";

export type SocialAnalysisKind = "content" | "account";

export interface SocialPlatformVO {
  key: SocialPlatform;
  label: string;
}

export interface SocialAnalysisStatusVO {
  enabled: boolean;
  configured: boolean;
  videoAnalysisSkillId?: string;
  accountAnalysisSkillId?: string;
  platforms: SocialPlatformVO[];
}

export interface SocialMetricVO {
  play?: string;
  like?: string;
  comment?: string;
  share?: string;
  favorite?: string;
}

export interface SocialProfileVO {
  id?: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  bio?: string;
  followers?: string;
  following?: string;
  likes?: string;
  works?: string;
}

export interface SocialWorkVO {
  id?: string;
  title?: string;
  description?: string;
  coverUrl?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  pageUrl?: string;
  mediaType?: string;
  duration?: string;
  publishedAt?: string;
  stats: SocialMetricVO;
}

export interface SocialInspectVO {
  platform: SocialPlatform;
  platformName: string;
  kind: SocialAnalysisKind;
  sourceUrl: string;
  profile?: SocialProfileVO;
  content?: SocialWorkVO;
  works: SocialWorkVO[];
  warnings: string[];
  fetchedAt: number;
}

export type VideoDownloadQuality = "quality" | "compat" | "speed";

export interface VideoDownloaderCapabilitiesVO {
  enabled: boolean;
  platforms: string[];
  maxFileBytes: number;
  tokenTtlSeconds: number;
}

export interface VideoDownloadResolveVO {
  id: string;
  platform: string;
  title: string;
  durationSeconds: number;
  width: number;
  height: number;
  estimatedBytes: number;
  quality: VideoDownloadQuality;
  expiresAt: number;
  fileName: string;
  downloadUrl: string;
  /** 上游可能附带的封面直链;拿不到就是 undefined,前端走兜底版式。 */
  coverUrl?: string;
}

export const socialAnalysisApi = {
  status: () => http.get<SocialAnalysisStatusVO>("/api/social-analysis/status"),
  inspect: (data: { url: string; kind: SocialAnalysisKind }) =>
    http.post<SocialInspectVO>("/api/social-analysis/inspect", data),
  downloaderPlatforms: () =>
    http.get<VideoDownloaderCapabilitiesVO>("/api/social-analysis/downloader/platforms"),
  resolveDownload: (data: { url: string; quality: VideoDownloadQuality }) =>
    http.post<VideoDownloadResolveVO>("/api/social-analysis/downloader/resolve", data),
};
