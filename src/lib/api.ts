import { http } from "./http";
import type { Result, PageResult } from "@/types/api";
import type {
  UserVO, LoginVO, UserLoginDTO, UserRegisterDTO, UpdatePasswordDTO,
} from "@/types/user";
import type {
  ProjectVO, ProjectDetailVO, CanvasDataVO, ShareVO,
  ProjectCreateDTO, ProjectUpdateDTO, CanvasSaveDTO, ProjectQuery,
} from "@/types/canvas";
import type {
  AiTaskVO, AiModelVO, AiHandlerVO, AiGenerateDTO, AiTaskQuery,
} from "@/types/ai";
import type { FileVO, FileQuery } from "@/types/file";
import type {
  DashboardOverviewVO, DashboardTrendVO, AdminUserVO, AdminUserQuery,
  AdminUserUpdateDTO, BannerVO, BannerCreateDTO, BannerUpdateDTO,
  AiProviderVO, AiProviderCreateDTO, AiProviderUpdateDTO,
  LogVO, LogQuery, ContentVO, ContentQuery, TrendQuery,
} from "@/types/admin";

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
};

export const projectApi = {
  list: (query: ProjectQuery) =>
    http.get<PageResult<ProjectVO>["data"]>("/api/projects", query as Record<string, string | number>),
  create: (data: ProjectCreateDTO) =>
    http.post<ProjectVO>("/api/projects", data),
  get: (id: number) =>
    http.get<ProjectDetailVO>(`/api/projects/${id}`),
  update: (id: number, data: ProjectUpdateDTO) =>
    http.put<ProjectVO>(`/api/projects/${id}`, data),
  delete: (id: number) =>
    http.delete<void>(`/api/projects/${id}`),
  saveCanvas: (id: number, data: CanvasSaveDTO) =>
    http.put<void>(`/api/projects/${id}/canvas`, data),
  getCanvas: (id: number) =>
    http.get<CanvasDataVO>(`/api/projects/${id}/canvas`),
  share: (id: number) =>
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
    http.get<PageResult<AiTaskVO>["data"]>("/api/ai/tasks", query as Record<string, string | number>),
  listModels: () =>
    http.get<AiModelVO[]>("/api/ai/models"),
  listHandlers: () =>
    http.get<AiHandlerVO[]>("/api/ai/handlers"),
};

export const fileApi = {
  upload: (file: File) =>
    http.upload<FileVO>("/api/files/upload", file),
  uploadBatch: (formData: FormData) =>
    http.upload<FileVO[]>("/api/files/upload/batch", formData),
  list: (query: FileQuery) =>
    http.get<PageResult<FileVO>["data"]>("/api/files", query as Record<string, string | number>),
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
      http.get<DashboardTrendVO>("/api/admin/dashboard/trend", query as Record<string, string>),
  },
  users: {
    list: (query: AdminUserQuery) =>
      http.get<PageResult<AdminUserVO>["data"]>("/api/admin/users", query as Record<string, string | number>),
    get: (id: number) =>
      http.get<AdminUserVO>(`/api/admin/users/${id}`),
    update: (id: number, data: AdminUserUpdateDTO) =>
      http.put<void>(`/api/admin/users/${id}`, data),
  },
  contents: {
    list: (query: ContentQuery) =>
      http.get<PageResult<ContentVO>["data"]>("/api/admin/contents", query as Record<string, string | number>),
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
  },
  settings: {
    get: () => http.get<Record<string, unknown>>("/api/admin/settings"),
    update: (data: Record<string, unknown>) => http.put<void>("/api/admin/settings", data),
  },
  logs: {
    list: (query: LogQuery) =>
      http.get<PageResult<LogVO>["data"]>("/api/admin/logs", query as Record<string, string | number>),
  },
};
