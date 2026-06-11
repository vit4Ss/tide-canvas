import type { PageQuery } from "./api";
import type { UserVO } from "./user";

export interface DashboardOverviewVO {
  totalUsers: number;
  todayNewUsers: number;
  activeUsers: number;
  totalApiCalls: number;
  todayApiCalls: number;
  totalProjects: number;
  todayNewProjects: number;
  totalStorageBytes: number;
}

export interface DailyTrendVO {
  date: string;
  newUsers: number;
  activeUsers: number;
}

export interface DailyCreationVO {
  date: string;
  projects: number;
  aiCalls: number;
}

export interface NameValueVO {
  name: string;
  value: number;
}

export interface DashboardChartsVO {
  userTrend: DailyTrendVO[];
  aiDistribution: NameValueVO[];
  dailyCreation: DailyCreationVO[];
  modelUsage: NameValueVO[];
}

export interface AdminUserVO extends UserVO {
  usedApiQuota: number;
  usedStorageBytes: number;
  projectCount: number;
}

export interface AdminUserUpdateDTO {
  role?: number;
  status?: number;
  apiQuota?: number;
  storageQuota?: number;
}

export interface AdminUserQuery extends PageQuery {
  keyword?: string;
  role?: number;
  status?: number;
}

export interface BannerVO {
  id: number;
  title: string;
  imageUrl: string;
  linkUrl: string;
  sortOrder: number;
  status: number;
  createTime: string;
}

export interface BannerCreateDTO {
  title: string;
  imageUrl: string;
  linkUrl?: string;
  sortOrder?: number;
  status?: number;
}

export type BannerUpdateDTO = Partial<BannerCreateDTO>;

export interface AiProviderVO {
  id: number;
  name: string;
  providerType: string;
  baseUrl: string;
  status: number;
  priority: number;
  rateLimit: number;
  config: Record<string, unknown>;
  createTime: string;
}

export interface AiProviderCreateDTO {
  name: string;
  providerType: string;
  apiKey: string;
  backupKeys?: string;
  baseUrl: string;
  priority?: number;
  rateLimit?: number;
  config?: Record<string, unknown>;
}

export interface AiProviderUpdateDTO extends Partial<AiProviderCreateDTO> {
  status?: number;
}

export interface LogVO {
  id: number;
  userId: number;
  username: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  createTime: string;
}

export interface LogQuery extends PageQuery {
  userId?: number;
  action?: string;
  keyword?: string;
  startTime?: string;
  endTime?: string;
}

export interface ContentVO {
  id: number;
  name: string;
  thumbnail: string;
  ownerName: string;
  status: number;
  createTime: string;
}

export interface ContentQuery extends PageQuery {
  keyword?: string;
  status?: number;
}

