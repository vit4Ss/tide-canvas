import { http, toParams } from "./http";
import type { PageData, PageResult, Result } from "@/types/api";
import type {
  UserVO, LoginVO, UserLoginDTO, UserRegisterDTO, UpdatePasswordDTO, UpdateProfileDTO,
} from "@/types/user";
import type {
  ProjectVO, ProjectDetailVO, CanvasDataVO, ShareVO,
  ProjectCreateDTO, ProjectUpdateDTO, CanvasSaveDTO, ProjectQuery,
} from "@/types/canvas";
import type {
  AiTaskVO, AiModelVO, AiHandlerVO, AiGenerateDTO, AiTaskQuery,
  AiGenerationLogVO, AiGenerationLogQuery,
} from "@/types/ai";
import type { FileVO, FileQuery } from "@/types/file";
import type {
  DashboardOverviewVO, DashboardChartsVO, AdminUserVO, AdminUserQuery,
  AdminUserUpdateDTO, BannerVO, BannerCreateDTO, BannerUpdateDTO,
  AiProviderVO, AiProviderCreateDTO, AiProviderUpdateDTO,
  LogVO, LogQuery, ContentVO, ContentQuery,
} from "@/types/admin";
import type {
  PointsBalanceVO, PointsTransactionVO, PointsTransactionQuery, CheckinStatusVO, CheckinCalendarVO,
} from "@/types/points";
import type {
  PostVO, PostDetailVO, CommentVO, PostCreateDTO, PostUpdateDTO, CommentCreateDTO, PostQuery,
} from "@/types/community";
import type {
  BlogVO, BlogDetailVO, BlogCreateDTO, BlogUpdateDTO, BlogTipDTO, BlogQuery,
} from "@/types/blog";
import type {
  RechargeOrderVO, RechargeCreateDTO, OrderQuery,
  PaymentInitiateVO, RechargeConfigVO,
} from "@/types/order";
import type {
  RedeemCodeVO, RedeemCodeQuery, RedeemResultVO, GenerateRedeemDTO,
} from "@/types/redeem";
import type {
  TeamVO, TeamCreateDTO, TeamJoinDTO,
} from "@/types/team";
import type {
  EmailTemplateVO, EmailTemplateUpdateDTO, EmailTemplatePreviewDTO,
  EmailRenderVO, EmailTemplateSendTestDTO,
} from "@/types/email-template";

export const authApi = {
  emailCode: (data: { email: string }) =>
    http.post<void>("/api/auth/email-code", data),
  register: (data: UserRegisterDTO) =>
    http.post<UserVO>("/api/auth/register", data),
  login: (data: UserLoginDTO) =>
    http.post<LoginVO>("/api/auth/login", data),
  logout: () =>
    http.post<void>("/api/auth/logout"),
  me: () =>
    http.get<UserVO>("/api/auth/me"),
  updatePassword: (data: UpdatePasswordDTO) =>
    http.put<void>("/api/auth/password", data),
  updateProfile: (data: UpdateProfileDTO) =>
    http.put<UserVO>("/api/auth/profile", data),
};

export const teamApi = {
  me: () => http.get<TeamVO | null>("/api/teams/me"),
  create: (data: TeamCreateDTO) => http.post<TeamVO>("/api/teams", data),
  join: (data: TeamJoinDTO) => http.post<TeamVO>("/api/teams/join", data),
  leave: () => http.post<void>("/api/teams/leave"),
  disband: () => http.post<void>("/api/teams/disband"),
  removeMember: (userId: number) => http.delete<void>(`/api/teams/members/${userId}`),
};

export const projectApi = {
  list: (query: ProjectQuery) =>
    http.get<PageResult<ProjectVO>["data"]>("/api/projects", toParams(query)),
  create: (data: ProjectCreateDTO) =>
    http.post<ProjectVO>("/api/projects", data),
  get: (id: string | number) =>
    http.get<ProjectDetailVO>(`/api/projects/${id}`),
  getByToken: (token: string) =>
    http.get<ProjectDetailVO>(`/api/projects/token/${token}`),
  update: (id: string | number, data: ProjectUpdateDTO) =>
    http.put<ProjectVO>(`/api/projects/${id}`, data),
  delete: (id: string | number) =>
    http.delete<void>(`/api/projects/${id}`),
  saveCanvas: (id: string | number, data: CanvasSaveDTO) =>
    http.put<void>(`/api/projects/${id}/canvas`, data),
  getCanvas: (id: string | number) =>
    http.get<CanvasDataVO>(`/api/projects/${id}/canvas`),
  share: (id: string | number) =>
    http.post<ShareVO>(`/api/projects/${id}/share`),
};

export const aiApi = {
  generate: (data: AiGenerateDTO) =>
    http.post<AiTaskVO>("/api/ai/generate", data),
  gridSplit: (imageUrl: string, rows: number, cols: number, cells?: number[]) =>
    http.post<string[]>("/api/ai/grid-split", { imageUrl, rows, cols, ...(cells && cells.length ? { cells } : {}) }),
  getTask: (taskId: number) =>
    http.get<AiTaskVO>(`/api/ai/tasks/${taskId}`),
  cancelTask: (taskId: number) =>
    http.delete<void>(`/api/ai/tasks/${taskId}`),
  listTasks: (query: AiTaskQuery) =>
    http.get<PageResult<AiTaskVO>["data"]>("/api/ai/tasks", toParams(query)),
  listModels: () =>
    http.get<AiModelVO[]>("/api/ai/models"),
  listHandlers: () =>
    http.get<AiHandlerVO[]>("/api/ai/handlers"),
  canvasLogs: (query: AiGenerationLogQuery) =>
    http.get<PageData<AiGenerationLogVO>>("/api/ai/logs", toParams(query)),
};

interface FilePresignVO {
  direct: boolean;
  uploadUrl?: string;
  key?: string;
  fileUrl?: string;
  contentType?: string;
}

export const fileApi = {
  upload: (file: File) =>
    http.upload<FileVO>("/api/files/upload", file),
  uploadProgress: (file: File, onProgress?: (pct: number) => void) =>
    http.uploadProgress<FileVO>("/api/files/upload", file, onProgress),
  uploadBatch: (formData: FormData) =>
    http.upload<FileVO[]>("/api/files/upload/batch", formData),
  presign: (data: { filename: string; contentType: string; fileType?: string }) =>
    http.post<FilePresignVO>("/api/files/presign", data),
  register: (data: { key: string; originalName: string; contentType: string; fileType?: string }) =>
    http.post<FileVO>("/api/files/register", data),
  list: (query: FileQuery) =>
    http.get<PageResult<FileVO>["data"]>("/api/files", toParams(query)),
  saveFromUrl: (data: { url: string; fileType?: string; originalName?: string }) =>
    http.post<FileVO>("/api/files/save-from-url", data),
  get: (id: number) =>
    http.get<FileVO>(`/api/files/${id}`),
  delete: (id: string | number) =>
    http.delete<void>(`/api/files/${id}`),
};

/**
 * 智能上传：OSS 环境走「前端直传」(presign → 浏览器 PUT 到 OSS → register)，文件不经后端、省带宽、支持大文件；
 * 本地存储或直传不可用时自动回退到服务器中转上传。两种路径都通过 onProgress 上报进度，返回 Result<FileVO>。
 */
export async function uploadFileSmart(file: File, onProgress?: (pct: number) => void): Promise<Result<FileVO>> {
  const contentType = file.type || "application/octet-stream";
  try {
    const pre = await fileApi.presign({ filename: file.name, contentType });
    if (pre.success && pre.data?.direct && pre.data.uploadUrl && pre.data.key) {
      const put = await http.putProgress(pre.data.uploadUrl, file, { "Content-Type": pre.data.contentType || contentType }, onProgress);
      if (put.ok) {
        return fileApi.register({ key: pre.data.key, originalName: file.name, contentType });
      }
      // 直传 PUT 失败（多为 OSS 桶未配 CORS，浏览器预检被拦）→ 不报错，落到下方服务器中转上传，保证上传始终可用。
      // 如需启用直传(省后端带宽/大文件友好)，请为 OSS 桶配置 CORS：来源=站点域名，方法=PUT/GET/HEAD，允许头=*，暴露头=ETag。
    }
  } catch {
    // presign 异常 → 回退中转上传
  }
  return http.uploadProgress<FileVO>("/api/files/upload", file, onProgress);
}

export const redeemApi = {
  redeem: (code: string) =>
    http.post<RedeemResultVO>("/api/redeem", { code }),
};

export interface BanInfo {
  actor: string;
  type: string;
  value: string;
  reason?: string;
  expireSeconds: number;
}

export const adminApi = {
  dashboard: {
    overview: () =>
      http.get<DashboardOverviewVO>("/api/admin/dashboard/overview"),
    charts: () =>
      http.get<DashboardChartsVO>("/api/admin/dashboard/charts"),
  },
  users: {
    list: (query: AdminUserQuery) =>
      http.get<PageResult<AdminUserVO>["data"]>("/api/admin/users", toParams(query)),
    get: (id: number) =>
      http.get<AdminUserVO>(`/api/admin/users/${id}`),
    update: (id: number, data: AdminUserUpdateDTO) =>
      http.put<void>(`/api/admin/users/${id}`, data),
  },
  contents: {
    list: (query: ContentQuery) =>
      http.get<PageResult<ContentVO>["data"]>("/api/admin/contents", toParams(query)),
    audit: (id: number, data: { status: number }) =>
      http.put<void>(`/api/admin/contents/${id}`, data),
  },
  banners: {
    list: () =>
      http.get<BannerVO[]>("/api/admin/banners"),
    create: (data: BannerCreateDTO) =>
      http.post<BannerVO>("/api/admin/banners", data),
    update: (id: number, data: BannerUpdateDTO) =>
      http.put<void>(`/api/admin/banners/${id}`, data),
    delete: (id: number) =>
      http.delete<void>(`/api/admin/banners/${id}`),
  },
  ai: {
    providers: {
      list: () => http.get<AiProviderVO[]>("/api/admin/ai/providers"),
      create: (data: AiProviderCreateDTO) => http.post<AiProviderVO>("/api/admin/ai/providers", data),
      update: (id: number, data: AiProviderUpdateDTO) => http.put<void>(`/api/admin/ai/providers/${id}`, data),
      delete: (id: number) => http.delete<void>(`/api/admin/ai/providers/${id}`),
      // 从供应商接口拉取可用模型 ID 列表（id 为雪花长整型字符串）；runware 供应商支持 search 关键词
      remoteModels: (id: string, search?: string) =>
        http.get<string[]>(`/api/admin/ai/providers/${id}/models${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    },
    models: {
      list: () => http.get<AiModelVO[]>("/api/admin/ai/models"),
      create: (data: Record<string, unknown>) => http.post<AiModelVO>("/api/admin/ai/models", data),
      update: (id: number, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/models/${id}`, data),
      delete: (id: number) => http.delete<void>(`/api/admin/ai/models/${id}`),
    },
    handlers: {
      list: () => http.get<AiHandlerVO[]>("/api/admin/ai/handlers"),
      update: (name: string, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/handlers/${name}`, data),
    },
    logs: {
      list: (query: AiGenerationLogQuery) =>
        http.get<PageData<AiGenerationLogVO>>("/api/admin/ai/logs", toParams(query)),
      get: (id: number) => http.get<AiGenerationLogVO>(`/api/admin/ai/logs/${id}`),
      // 当前筛选条件下的上游成本汇总（USD）
      costSum: (query: AiGenerationLogQuery) =>
        http.get<number>("/api/admin/ai/logs/cost-sum", toParams(query)),
    },
  },
  redeem: {
    generate: (data: GenerateRedeemDTO) => http.post<string[]>("/api/admin/redeem/generate", data),
    list: (query: RedeemCodeQuery) => http.get<PageData<RedeemCodeVO>>("/api/admin/redeem", toParams(query)),
    updateStatus: (id: number, status: number) => http.put<void>(`/api/admin/redeem/${id}/status`, { status }),
    delete: (id: number) => http.delete<void>(`/api/admin/redeem/${id}`),
  },
  settings: {
    get: () => http.get<Record<string, unknown>>("/api/admin/settings"),
    update: (data: Record<string, unknown>) => http.put<void>("/api/admin/settings", data),
  },
  emailTemplates: {
    list: () => http.get<EmailTemplateVO[]>("/api/admin/email-templates"),
    get: (id: number) => http.get<EmailTemplateVO>(`/api/admin/email-templates/${id}`),
    update: (id: number, data: EmailTemplateUpdateDTO) =>
      http.put<void>(`/api/admin/email-templates/${id}`, data),
    preview: (data: EmailTemplatePreviewDTO) =>
      http.post<EmailRenderVO>("/api/admin/email-templates/preview", data),
    sendTest: (id: number, data: EmailTemplateSendTestDTO) =>
      http.post<void>(`/api/admin/email-templates/${id}/send-test`, data),
  },
  logs: {
    list: (query: LogQuery) =>
      http.get<PageResult<LogVO>["data"]>("/api/admin/logs", toParams(query)),
  },
  points: {
    transactions: (query: PointsTransactionQuery) =>
      http.get<PageData<PointsTransactionVO>>("/api/admin/points/transactions", toParams(query)),
    adjust: (data: { userId: number; amount: number; remark?: string }) =>
      http.post<void>("/api/admin/points/adjust", data),
    refundTask: (data: { taskId: number; reason?: string }) =>
      http.post<number>("/api/admin/points/refund-task", data),
  },
  security: {
    bans: () => http.get<BanInfo[]>("/api/admin/security/bans"),
    ban: (data: { type: "user" | "ip"; value: string; seconds?: number; reason?: string }) =>
      http.post<void>("/api/admin/security/ban", data),
    unban: (actor: string) => http.post<void>("/api/admin/security/unban", { actor }),
  },
  authors: {
    list: (query: AdminUserQuery) =>
      http.get<PageData<AdminUserVO>>("/api/admin/authors", toParams(query)),
    grant: (userId: number) =>
      http.post<void>(`/api/admin/authors/${userId}/grant`),
    revoke: (userId: number) =>
      http.post<void>(`/api/admin/authors/${userId}/revoke`),
  },
  orders: {
    list: (query: AdminUserQuery) =>
      http.get<PageData<RechargeOrderVO>>("/api/admin/orders", toParams(query)),
    get: (id: number) =>
      http.get<RechargeOrderVO>(`/api/admin/orders/${id}`),
    pay: (id: number) =>
      http.post<void>(`/api/admin/orders/${id}/pay`),
  },
};

// ========== 积分 ==========
export const pointsApi = {
  balance: () =>
    http.get<PointsBalanceVO>("/api/points/balance"),
  transactions: (query: PointsTransactionQuery) =>
    http.get<PageData<PointsTransactionVO>>("/api/points/transactions", toParams(query)),
};

// ========== 签到 ==========
export const checkinApi = {
  checkin: () =>
    http.post<CheckinStatusVO>("/api/checkin"),
  status: () =>
    http.get<CheckinStatusVO>("/api/checkin/status"),
  calendar: (year: number, month: number) =>
    http.get<CheckinCalendarVO>("/api/checkin/calendar", { year, month }),
};

// ========== 社区帖子 ==========
export const communityApi = {
  list: (query: PostQuery) =>
    http.get<PageData<PostVO>>("/api/posts", toParams(query)),
  get: (id: number | string) =>
    http.get<PostDetailVO>(`/api/posts/${id}`),
  create: (data: PostCreateDTO) =>
    http.post<PostVO>("/api/posts", data),
  update: (id: number | string, data: PostUpdateDTO) =>
    http.put<void>(`/api/posts/${id}`, data),
  delete: (id: number | string) =>
    http.delete<void>(`/api/posts/${id}`),
  like: (id: number | string) =>
    http.post<boolean>(`/api/posts/${id}/like`),
  listComments: (id: number | string) =>
    http.get<CommentVO[]>(`/api/posts/${id}/comments`),
  addComment: (id: number | string, data: CommentCreateDTO) =>
    http.post<CommentVO>(`/api/posts/${id}/comments`, data),
  deleteComment: (commentId: number | string) =>
    http.delete<void>(`/api/posts/comments/${commentId}`),
};

// ========== 博客 ==========
export const blogApi = {
  list: (query: BlogQuery) =>
    http.get<PageData<BlogVO>>("/api/blogs", toParams(query)),
  get: (id: number | string) =>
    http.get<BlogDetailVO>(`/api/blogs/${id}`),
  create: (data: BlogCreateDTO) =>
    http.post<BlogVO>("/api/blogs", data),
  update: (id: number | string, data: BlogUpdateDTO) =>
    http.put<void>(`/api/blogs/${id}`, data),
  delete: (id: number | string) =>
    http.delete<void>(`/api/blogs/${id}`),
  purchase: (id: number | string) =>
    http.post<void>(`/api/blogs/${id}/purchase`),
  tip: (id: number | string, data: BlogTipDTO) =>
    http.post<void>(`/api/blogs/${id}/tip`, data),
  like: (id: number | string) =>
    http.post<boolean>(`/api/blogs/${id}/like`),
  my: (query: BlogQuery) =>
    http.get<PageData<BlogVO>>("/api/blogs/my", toParams(query)),
};

// ========== 订单 ==========
export const orderApi = {
  create: (data: RechargeCreateDTO) =>
    http.post<RechargeOrderVO>("/api/orders/recharge", data),
  list: (query: OrderQuery) =>
    http.get<PageData<RechargeOrderVO>>("/api/orders", toParams(query)),
  get: (id: number) =>
    http.get<RechargeOrderVO>(`/api/orders/${id}`),
  cancel: (id: number) =>
    http.post<void>(`/api/orders/${id}/cancel`),
  rechargeConfig: () =>
    http.get<RechargeConfigVO>("/api/orders/recharge-config"),
  pay: (id: number, payType?: string) =>
    http.post<PaymentInitiateVO>(`/api/orders/${id}/pay`, payType ? { payType } : {}),
  sync: (id: number) =>
    http.post<RechargeOrderVO>(`/api/orders/${id}/sync`),
};
