import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { SocialActivityRecordQuery, SocialActivityRecordVO } from "@/types/social-record";

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
  imageAnalysisSkillId?: string;
  accountAnalysisSkillId?: string;
  platforms: SocialPlatformVO[];
}

export interface SocialMetricVO {
  play?: string;
  like?: string;
  comment?: string;
  share?: string;
  favorite?: string;
  coin?: string;
  danmaku?: string;
  download?: string;
}

export interface SocialPlatformDetails {
  fields?: Array<{ key: string; label: string; value: string; format?: string }>;
  tags?: string[];
  chapters?: Array<{ title: string; start?: number; duration?: string }>;
  languages?: string[];
}

export interface SocialProfileVO {
  details?: SocialPlatformDetails;
  id?: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  pageUrl?: string;
  bio?: string;
  followers?: string;
  following?: string;
  likes?: string;
  works?: string;
}

export interface SocialWorkVO {
  platform?: SocialPlatform;
  details?: SocialPlatformDetails;
  id?: string;
  title?: string;
  description?: string;
  coverUrl?: string;
  imageUrls?: string[];
  mediaUrl?: string;
  mediaUrls?: string[];
  pageUrl?: string;
  mediaType?: string;
  duration?: string;
  publishedAt?: string;
  stats: SocialMetricVO;
}

export interface SocialInspectVO {
  recordId?: string;
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
  recordId?: string;
  /** 上游可能附带的封面直链;拿不到就是 undefined,前端走兜底版式。 */
  coverUrl?: string;
}

export type SocialActivityRecordDetailVO = SocialActivityRecordVO & {
  snapshot?: SocialInspectVO;
};

export const socialAnalysisApi = {
  status: () => http.get<SocialAnalysisStatusVO>("/api/social-analysis/status"),
  inspect: (data: { url: string; kind: SocialAnalysisKind }) =>
    http.post<SocialInspectVO>("/api/social-analysis/inspect", data),
  downloaderPlatforms: () =>
    http.get<VideoDownloaderCapabilitiesVO>("/api/social-analysis/downloader/platforms"),
  resolveDownload: (data: { url: string; quality: VideoDownloadQuality }) =>
    http.post<VideoDownloadResolveVO>("/api/social-analysis/downloader/resolve", data),
  records: (query: SocialActivityRecordQuery = {}) =>
    http.get<PageData<SocialActivityRecordVO>>("/api/social-analysis/records", toParams(query)),
  record: (id: string) =>
    http.get<SocialActivityRecordDetailVO>(`/api/social-analysis/records/${id}`),
};
