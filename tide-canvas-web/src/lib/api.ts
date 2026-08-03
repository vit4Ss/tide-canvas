import { http, toParams } from "./http";
import { ResultCode, type PageData, type PageResult, type Result } from "@/types/api";
import type {
  UserVO, LoginVO, UserLoginDTO, UserRegisterDTO, RegisterLocalDTO, UpdatePasswordDTO, UpdateProfileDTO,
  ResetPasswordDTO,
} from "@/types/user";
import type {
  ProjectVO, ProjectDetailVO, CanvasDataVO, CanvasSaveVO, ShareVO,
  ProjectCreateDTO, ProjectUpdateDTO, CanvasSaveDTO, ProjectQuery,
} from "@/types/canvas";
import type {
  AiTaskVO, AiModelVO, AiHandlerVO, AiToolVO, AiGenerateDTO, AiGenerateInput, AiTaskQuery,
  AiGenerationLogVO, AiGenerationLogQuery,
} from "@/types/ai";
import type { FileCategory, FileVO, FileQuery } from "@/types/file";
// 画布风格库所需类型
import type {
  StylePresetQuery, StylePresetVO, StyleFavoriteToggleVO, StylePresetSaveDTO,
} from "@/types/style";
import { fileSizeExceededResult, resolveUploadLimitBytes, type UploadLimitOptions } from "@/lib/upload-limits";
import {
  generateAiTaskIdempotent,
  type AiGenerationJournalOptions,
} from "@/lib/ai-generation-idempotency";

export const authApi = {
  /** 注册开关(后台配置管理 auth.registerClosed);登录页据此隐藏注册入口 */
  registerConfig: () =>
    http.get<{ registerClosed: boolean }>("/api/auth/register-config"),
  emailCode: (data: { email: string }) =>
    http.post<void>("/api/auth/email-code", data),
  register: (data: UserRegisterDTO) =>
    http.post<UserVO>("/api/auth/register", data),
  /** 用户名+密码免邮箱注册；成功即返回登录态（注册即登录） */
  registerLocal: (data: RegisterLocalDTO) =>
    http.post<LoginVO>("/api/auth/register-local", data),
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
    http.put<CanvasSaveVO>(`/api/projects/${id}/canvas`, data),
  getCanvas: (id: string | number) =>
    http.get<CanvasDataVO>(`/api/projects/${id}/canvas`),
  share: (id: string | number) =>
    http.post<ShareVO>(`/api/projects/${id}/share`),
};

export const aiApi = {
  generate: (data: AiGenerateDTO) =>
    http.post<AiTaskVO>("/api/ai/generate", data),
  generateIdempotent: (
    data: AiGenerateInput,
    scope: string,
    options?: AiGenerationJournalOptions,
  ) => generateAiTaskIdempotent(data, scope, options),
  optimizePrompt: (prompt: string) =>
    http.post<{ prompt: string }>("/api/ai/optimize-prompt", { prompt }),
  // 「AI 优化」单次实扣积分（含团队倍率，后端为准）；未配置文本模型时为 0
  optimizeCost: () =>
    http.get<{ cost: number }>("/api/ai/optimize-cost"),
  gridSplit: (imageUrl: string, rows: number, cols: number, cells?: number[]) =>
    http.post<string[]>("/api/ai/grid-split", { imageUrl, rows, cols, ...(cells && cells.length ? { cells } : {}) }),
  // taskId 同为雪花 ID 字符串（>2^53，number 会丢精度）
  getTask: (taskId: string) =>
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
  /** GET /api/ai/tools — 启用中的独立工具配置（公开）。 */
  tools: () =>
    http.get<AiToolVO[]>("/api/ai/tools"),
  canvasLogs: (query: AiGenerationLogQuery) =>
    http.get<PageData<AiGenerationLogVO>>("/api/ai/logs", toParams(query)),
};

interface FilePresignVO {
  direct: boolean;
  uploadUrl?: string;
  key?: string;
  fileUrl?: string;
  contentType?: string;
  /** Headers covered by the storage signature; forward them unchanged. */
  headers?: Record<string, string>;
}

export const fileApi = {
  upload: (file: File) =>
    http.upload<FileVO>("/api/files/upload", file),
  uploadProgress: (file: File, onProgress?: (pct: number) => void) =>
    http.uploadProgress<FileVO>("/api/files/upload", file, onProgress),
  uploadBatch: (formData: FormData) =>
    http.upload<FileVO[]>("/api/files/upload/batch", formData),
  presign: (data: { filename: string; contentType: string; size: number; fileType?: string; category?: FileCategory }) =>
    http.post<FilePresignVO>("/api/files/presign", data),
  register: (data: { key: string; originalName: string; contentType: string; fileType?: string; category?: FileCategory }) =>
    http.post<FileVO>("/api/files/register", data),
  list: (query: FileQuery) =>
    http.get<PageResult<FileVO>["data"]>("/api/files", toParams(query)),
  saveFromUrl: (data: { url: string; fileType?: string; category?: FileCategory; originalName?: string }) =>
    http.post<FileVO>("/api/files/save-from-url", data),
  get: (id: string) =>
    http.get<FileVO>(`/api/files/detail/${id}`),
  delete: (id: string | number) =>
    http.delete<void>(`/api/files/detail/${id}`),
};

/**
 * 智能上传：OSS 环境走「前端直传」(presign → 浏览器 PUT 到 OSS → register)，文件不经后端、省带宽、支持大文件；
 * 本地存储或直传不可用时自动回退到服务器中转上传。两种路径都通过 onProgress 上报进度，返回 Result<FileVO>。
 */
export interface UploadFileSmartOptions extends UploadLimitOptions {
  category?: FileCategory;
}

function retryableUploadResult(result: Result<unknown>): boolean {
  return !result.code || result.code === 408 || result.code === 429 || (result.code >= 500 && result.code < 600);
}

function executableUploadResult<T>(file: File): Result<T> | null {
  const contentType = file.type.toLowerCase().split(";", 1)[0].trim();
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const blockedTypes = new Set([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/javascript",
    "text/javascript",
    "application/xml",
    "text/xml",
  ]);
  const blockedExtensions = new Set([".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".xml"]);
  if (!blockedTypes.has(contentType) && !blockedExtensions.has(extension)) return null;
  return {
    success: false,
    code: ResultCode.FILE_TYPE_NOT_ALLOWED,
    message: "为保护账号安全，不支持 HTML、SVG、JavaScript 或 XML 可执行文件",
    data: undefined as T,
    timestamp: Date.now(),
  };
}

export async function uploadFileSmart(file: File, onProgress?: (pct: number) => void, options?: UploadFileSmartOptions): Promise<Result<FileVO>> {
  // 上传前置尺寸校验(画布参考图/视频按模型上限,带 label 友好提示);超限直接返回失败 Result。
  const uploadLimit = resolveUploadLimitBytes(options?.maxBytes);
  const tooLarge = fileSizeExceededResult<FileVO>(file, { ...options, maxBytes: uploadLimit });
  if (tooLarge) return tooLarge;
  const executable = executableUploadResult<FileVO>(file);
  if (executable) return executable;
  const contentType = file.type || "application/octet-stream";
  try {
    const pre = await fileApi.presign({ filename: file.name, contentType, size: file.size, category: options?.category });
    if (pre.success && pre.data?.direct && pre.data.uploadUrl && pre.data.key) {
      const putHeaders = {
        "Content-Type": pre.data.contentType || contentType,
        ...pre.data.headers,
      };
      const put = await http.putProgress(pre.data.uploadUrl, file, putHeaders, onProgress);
      const registration = {
        key: pre.data.key,
        originalName: file.name,
        contentType,
        category: options?.category,
      };
      if (put.ok) {
        const registered = await fileApi.register(registration);
        // register is server-idempotent. A second request recovers the original
        // File when the first response was lost after its transaction committed.
        return retryableUploadResult(registered)
          ? fileApi.register(registration)
          : registered;
      }
      // A permissive OSS endpoint may accept PUT while a broken CORS response
      // remains unreadable to XHR. Verify/register before uploading it again.
      const recovered = await fileApi.register(registration);
      if (recovered.success) return recovered;
      if (retryableUploadResult(recovered)) {
        const retried = await fileApi.register(registration);
        // If both registration responses are ambiguous, do not fall back to a
        // second multipart upload: the OSS object may already be registered and
        // the retry-safe register endpoint remains the correct recovery path.
        if (retryableUploadResult(retried)) return retried;
        if (retried.success) return retried;
      }
      // 直传 PUT 失败（多为 OSS 桶未配 CORS，浏览器预检被拦）→ 不报错，落到下方服务器中转上传，保证上传始终可用。
      // 如需启用直传(省后端带宽/大文件友好)，请为 OSS 桶配置 CORS：来源=站点域名，方法=PUT/GET/HEAD，允许头=*，暴露头=ETag。
    }
  } catch {
    // presign 异常 → 回退中转上传
  }
  if (options?.category) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", options.category);
    return http.uploadProgress<FileVO>("/api/files/upload", formData, onProgress);
  }
  return http.uploadProgress<FileVO>("/api/files/upload", file, onProgress);
}

// ── 画布风格库 API(图片节点的风格选择器)——对接后端 /api/styles ──────────
export const styleApi = {
  list: (query: StylePresetQuery) =>
    http.get<PageResult<StylePresetVO>["data"]>("/api/styles", toParams(query)),
  create: (data: StylePresetSaveDTO) =>
    http.post<StylePresetVO>("/api/styles", data),
  toggleFavorite: (id: string) =>
    http.post<StyleFavoriteToggleVO>(`/api/styles/${id}/favorite`),
  recordUse: (id: string) =>
    http.post<void>(`/api/styles/${id}/use`),
};
