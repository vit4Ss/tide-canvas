export type SocialActivityType = "analysis" | "download";

export type SocialActivityStatus =
  | "processing"
  | "ready"
  | "downloading"
  | "succeeded"
  | "failed"
  | "expired";

export interface SocialActivityRecordVO {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string;
  type: SocialActivityType;
  kind?: string;
  platform?: string;
  sourceUrl: string;
  title?: string;
  /** 被分析账号在当时快照中的头像。 */
  avatarUrl?: string;
  status: SocialActivityStatus;
  quality?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  estimatedBytes?: number;
  downloadedBytes?: number;
  analysisRunId?: string;
  pointCost?: number;
  refunded?: boolean;
  errorMessage?: string;
  expiresAt?: string;
  createTime: string;
  updateTime: string;
  completedAt?: string;
}

export interface SocialActivityRecordQuery {
  pageNum?: number;
  pageSize?: number;
  type?: SocialActivityType;
  status?: SocialActivityStatus;
  platform?: string;
  keyword?: string;
  userId?: string;
  userKeyword?: string;
  startDate?: string;
  endDate?: string;
}
