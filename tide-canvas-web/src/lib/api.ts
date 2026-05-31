import { http, toParams } from "./http";
import type { PageData, PageResult } from "@/types/api";
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
  DashboardOverviewVO, DashboardTrendVO, AdminUserVO, AdminUserQuery,
  AdminUserUpdateDTO, BannerVO, BannerCreateDTO, BannerUpdateDTO,
  AiProviderVO, AiProviderCreateDTO, AiProviderUpdateDTO,
  LogVO, LogQuery, ContentVO, ContentQuery, TrendQuery,
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
} from "@/types/order";

export const authApi = {
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

export const fileApi = {
  upload: (file: File) =>
    http.upload<FileVO>("/api/files/upload", file),
  uploadBatch: (formData: FormData) =>
    http.upload<FileVO[]>("/api/files/upload/batch", formData),
  list: (query: FileQuery) =>
    http.get<PageResult<FileVO>["data"]>("/api/files", toParams(query)),
  saveFromUrl: (data: { url: string; fileType?: string; originalName?: string }) =>
    http.post<FileVO>("/api/files/save-from-url", data),
  get: (id: number) =>
    http.get<FileVO>(`/api/files/${id}`),
  delete: (id: number) =>
    http.delete<void>(`/api/files/${id}`),
};

export const adminApi = {
  dashboard: {
    overview: () =>
      http.get<DashboardOverviewVO>("/api/admin/dashboard/overview"),
    trend: (query: TrendQuery) =>
      http.get<DashboardTrendVO>("/api/admin/dashboard/trend", toParams(query)),
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
      // 从供应商接口拉取可用模型 ID 列表（id 为雪花长整型字符串）
      remoteModels: (id: string) => http.get<string[]>(`/api/admin/ai/providers/${id}/models`),
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
    },
  },
  settings: {
    get: () => http.get<Record<string, unknown>>("/api/admin/settings"),
    update: (data: Record<string, unknown>) => http.put<void>("/api/admin/settings", data),
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
};
