import { http, toParams } from "./http";
import type { PageData, PageResult, Result } from "@/types/api";
import type {
  UserVO, LoginVO, UserLoginDTO, UserRegisterDTO, UpdatePasswordDTO, UpdateProfileDTO,
  ResetPasswordDTO,
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

export const authApi = {
  emailCode: (data: { email: string }) =>
    http.post<void>("/api/auth/email-code", data),
  register: (data: UserRegisterDTO) =>
    http.post<UserVO>("/api/auth/register", data),
  login: (data: UserLoginDTO) =>
    http.post<LoginVO>("/api/auth/login", data),
  loginCode: (data: { email: string; code: string }) =>
    http.post<LoginVO>("/api/auth/login-code", data),
  logout: () =>
    http.post<void>("/api/auth/logout"),
  me: () =>
    http.get<UserVO>("/api/auth/me"),
  updatePassword: (data: UpdatePasswordDTO) =>
    http.put<void>("/api/auth/password", data),
  updateProfile: (data: UpdateProfileDTO) =>
    http.put<UserVO>("/api/auth/profile", data),
  resetPassword: (data: ResetPasswordDTO) =>
    http.post<void>("/api/auth/reset-password", data),
};

export const projectApi = {
  list: (query: ProjectQuery) =>
    http.get<PageResult<ProjectVO>["data"]>("/api/projects", toParams(query)),
  create: (data: ProjectCreateDTO) =>
    http.post<ProjectVO>("/api/projects", data),
  get: (id: string | number) =>
    http.get<ProjectDetailVO>(`/api/projects/${id}`),
  getByToken: (token: string) =>
    http.get<ProjectDetailVO>(`/api/shared/${token}`),
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
  optimizePrompt: (prompt: string) =>
    http.post<{ prompt: string }>("/api/ai/optimize-prompt", { prompt }),
  gridSplit: (imageUrl: string, rows: number, cols: number, cells?: number[]) =>
    http.post<string[]>("/api/ai/grid-split", { imageUrl, rows, cols, ...(cells && cells.length ? { cells } : {}) }),
  getTask: (taskId: number) =>
    http.get<AiTaskVO>(`/api/ai/tasks/${taskId}`),
  // taskId 是雪花 ID(> 2^53),必须以字符串透传,用 Number() 会丢精度导致删错任务。
  cancelTask: (taskId: string | number) =>
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
    http.get<FileVO>(`/api/files/detail/${id}`),
  delete: (id: string | number) =>
    http.delete<void>(`/api/files/detail/${id}`),
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
