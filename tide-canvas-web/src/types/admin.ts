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
  todayVisits: number;
  todayVisitors: number;
  todayLogins: number;
  activeWeek: number;
  activeMonth: number;
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

export interface DailyVisitVO {
  date: string;
  pv: number;
  uv: number;
}

export interface DailyCountVO {
  date: string;
  count: number;
}

export interface DashboardChartsVO {
  userTrend: DailyTrendVO[];
  aiDistribution: NameValueVO[];
  dailyCreation: DailyCreationVO[];
  modelUsage: NameValueVO[];
  visitTrend: DailyVisitVO[];
  loginTrend: DailyCountVO[];
}

export interface ActiveUserVO {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  points: number;
  lastLoginTime: string;
}

export interface AdminUserVO extends UserVO {
  usedApiQuota: number;
  usedStorageBytes: number;
  projectCount: number;
}

export interface AdminUserUpdateDTO {
  role?: number;
  vipLevel?: number;
  roleId?: number;
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

export interface AccessLogVO {
  id: number;
  userId: number | null;
  username: string | null;
  method: string;
  path: string;
  query: string | null;
  status: number;
  durationMs: number;
  ip: string;
  userAgent: string | null;
  createTime: string;
}

export interface AccessLogQuery extends PageQuery {
  userId?: number;
  path?: string;
  keyword?: string;
  startTime?: string;
  endTime?: string;
}

export interface LoginLogVO {
  id: number;
  userId: number | null;
  username: string;
  status: number;
  failReason: string | null;
  ip: string;
  userAgent: string | null;
  createTime: string;
}

export interface LoginLogQuery extends PageQuery {
  keyword?: string;
  status?: number;
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

// 会员等级配置项（对齐后端 /api/admin/vip-levels）
export interface VipLevelVO {
  level: number;
  name: string;
  concurrency: number; // 该等级 AI 并发上限，0=不限
}

