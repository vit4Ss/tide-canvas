import { fetchWithAuth, http, toParams } from "./http";
import type { PageData, PageQuery, PageResult, Result } from "@/types/api";
import type {
  UserVO, LoginVO, UserLoginDTO, UserRegisterDTO, UpdatePasswordDTO, UpdateProfileDTO,
  PasswordResetRequestDTO, PasswordResetConfirmDTO,
} from "@/types/user";
import type {
  ProjectVO, ProjectDetailVO, CanvasDataVO, ShareVO,
  ProjectCreateDTO, ProjectUpdateDTO, CanvasSaveDTO, ProjectQuery,
} from "@/types/canvas";
import type {
  AiTaskVO, AiModelVO, AiIconAssetVO, AiHandlerVO, AiGenerateDTO, AiTaskQuery, AiTaskStreamEvent,
  AiGenerationLogVO, AiGenerationLogQuery,
} from "@/types/ai";
import type { FileVO, FileQuery, SystemUploadVO, StorageUsageVO } from "@/types/file";
import type {
  CreationConversationVO, CreationMode, AppendConversationMessageDTO,
  ConversationMessageVO, UpdateConversationMessageDTO,
} from "@/types/conversation";
import type {
  DashboardOverviewVO, DashboardChartsVO, AdminUserVO, AdminUserQuery,
  AdminUserCreateDTO, AdminUserUpdateDTO, AdminUserPasswordResetDTO, BannerVO, BannerCreateDTO, BannerUpdateDTO,
  AiProviderVO, AiProviderCreateDTO, AiProviderUpdateDTO,
  AiUpstreamModelVO, AiModelRouteVO, AiRouteDecisionLogVO,
  LogVO, LogQuery, ContentVO, ContentQuery,
  AccessLogVO, AccessLogQuery, LoginLogVO, LoginLogQuery, ActiveUserVO,
  VipLevelVO,
} from "@/types/admin";
import type { SystemMetricsVO, RedisInfoVO, SessionVO } from "@/types/monitor";
import type {
  ConversationVO, MessageVO, UserStatusVO, SendMessageDTO, OpenStaffDTO, ConversationType,
} from "@/types/im";
import type { RoleVO, RoleSaveDTO, PermissionGroup } from "@/types/role";
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
  FollowUserVO, FollowStatusVO, FollowQuery,
} from "@/types/follow";
import type {
  NotificationVO, NotificationQuery, UnreadCountVO,
} from "@/types/notification";
import type { AssistantPetStyle } from "@/types/assistant";
import type {
  RechargeOrderVO, RechargeCreateDTO, OrderQuery, AdminOrderQuery,
  PaymentInitiateVO, RechargeConfigVO,
} from "@/types/order";
import type {
  RedeemCodeVO, RedeemCodeQuery, RedeemResultVO, GenerateRedeemDTO,
} from "@/types/redeem";
import type {
  TeamVO, TeamCreateDTO, TeamJoinDTO,
} from "@/types/team";
import type {
  StylePresetQuery, StylePresetVO, StylePresetSaveDTO, StyleFavoriteToggleVO,
} from "@/types/style";
import type {
  EmailTemplateVO, EmailTemplateUpdateDTO, EmailTemplatePreviewDTO,
  EmailRenderVO, EmailTemplateSendTestDTO,
} from "@/types/email-template";
import { fileSizeExceededResult, resolveUploadLimitBytes, type UploadLimitOptions } from "@/lib/upload-limits";

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
  requestPasswordReset: (data: PasswordResetRequestDTO) =>
    http.post<void>("/api/auth/password-reset/request", data),
  confirmPasswordReset: (data: PasswordResetConfirmDTO) =>
    http.post<void>("/api/auth/password-reset/confirm", data),
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
    http.put<CanvasDataVO>(`/api/projects/${id}/canvas`, data),
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
  getTask: (taskId: string | number) =>
    http.get<AiTaskVO>(`/api/ai/tasks/${taskId}`),
  streamTask: async (
    taskId: string | number,
    onEvent: (event: AiTaskStreamEvent) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetchWithAuth(`/api/ai/tasks/${taskId}/stream`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`流式连接失败 (HTTP ${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = frame.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (payload) onEvent(JSON.parse(payload) as AiTaskStreamEvent);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  },
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
  deleteLog: (id: number) =>
    http.delete<void>(`/api/ai/logs/${id}`),
};

export const assistantApi = {
  petStyles: () =>
    http.get<AssistantPetStyle[]>("/api/settings/assistant-pet-styles"),
};

export const conversationApi = {
  list: (query: { pageNum?: number; pageSize?: number } = {}) =>
    http.get<PageResult<CreationConversationVO>["data"]>("/api/conversations", query),
  create: (mode: CreationMode) =>
    http.post<CreationConversationVO>("/api/conversations", { mode }),
  get: (id: string) =>
    http.get<CreationConversationVO>(`/api/conversations/${id}`),
  update: (id: string, data: { title?: string; pinned?: boolean; activeLeafMessageId?: string }) =>
    http.patch<CreationConversationVO>(`/api/conversations/${id}`, data),
  delete: (id: string) =>
    http.delete<void>(`/api/conversations/${id}`),
  appendMessage: (id: string, data: AppendConversationMessageDTO) =>
    http.post<ConversationMessageVO>(`/api/conversations/${id}/messages`, data),
  updateMessage: (id: string, messageId: string, data: UpdateConversationMessageDTO) =>
    http.patch<ConversationMessageVO>(`/api/conversations/${id}/messages/${messageId}`, data),
};

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
interface FilePresignVO {
  direct: boolean;
  uploadUrl?: string;
  key?: string;
  fileUrl?: string;
  contentType?: string;
}

export const fileApi = {
  upload: (file: File) => {
    const tooLarge = fileSizeExceededResult<FileVO>(file);
    if (tooLarge) return Promise.resolve(tooLarge);
    return http.upload<FileVO>("/api/files/upload", file);
  },
  uploadProgress: (file: File, onProgress?: (pct: number) => void, options?: UploadLimitOptions) => {
    const tooLarge = fileSizeExceededResult<FileVO>(file, options);
    if (tooLarge) return Promise.resolve(tooLarge);
    return http.uploadProgress<FileVO>("/api/files/upload", file, onProgress);
  },
  systemUploadProgress: (file: File, onProgress?: (pct: number) => void, options?: UploadLimitOptions & { bizType?: string }) => {
    const tooLarge = fileSizeExceededResult<SystemUploadVO>(file, options);
    if (tooLarge) return Promise.resolve(tooLarge);
    const formData = new FormData();
    formData.append("file", file);
    if (options?.bizType) formData.append("bizType", options.bizType);
    return http.uploadProgress<SystemUploadVO>("/api/files/system-upload", formData, onProgress);
  },
  uploadBatch: (formData: FormData) => {
    if (typeof File !== "undefined") {
      for (const value of formData.values()) {
        if (value instanceof File) {
          const tooLarge = fileSizeExceededResult<FileVO[]>(value);
          if (tooLarge) return Promise.resolve(tooLarge);
        }
      }
    }
    return http.upload<FileVO[]>("/api/files/upload/batch", formData);
  },
  presign: (data: { filename: string; contentType: string; fileType?: string; purpose?: "asset" | "conversation" }) =>
    http.post<FilePresignVO>("/api/files/presign", data),
  register: (data: { key: string; originalName: string; contentType: string; fileType?: string }) =>
    http.post<FileVO>("/api/files/register", data),
  list: (query: FileQuery) =>
    http.get<PageResult<FileVO>["data"]>("/api/files", toParams(query)),
  storageUsage: () => http.get<StorageUsageVO>("/api/files/storage-usage"),
  saveFromUrl: (data: { url: string; fileType?: string; originalName?: string }) =>
    http.post<FileVO>("/api/files/save-from-url", data),
  get: (id: number) =>
    http.get<FileVO>(`/api/files/${id}`),
  delete: (id: string | number) =>
    http.delete<void>(`/api/files/${id}`),
};

/**
 * 鏅鸿兘涓婁紶锛歄SS 鐜璧般€屽墠绔洿浼犮€?presign 鈫?娴忚鍣?PUT 鍒?OSS 鈫?register)锛屾枃浠朵笉缁忓悗绔€佺渷甯﹀銆佹敮鎸佸ぇ鏂囦欢锛?
 * 鏈湴瀛樺偍鎴栫洿浼犱笉鍙敤鏃惰嚜鍔ㄥ洖閫€鍒版湇鍔″櫒涓浆涓婁紶銆備袱绉嶈矾寰勯兘閫氳繃 onProgress 涓婃姤杩涘害锛岃繑鍥?Result<FileVO>銆?
 */
export async function uploadFileSmart(
  file: File,
  onProgress?: (pct: number) => void,
  options?: UploadLimitOptions & { purpose?: "asset" | "conversation" },
): Promise<Result<FileVO>> {
  const uploadLimit = resolveUploadLimitBytes(options?.maxBytes);
  const tooLarge = fileSizeExceededResult<FileVO>(file, { ...options, maxBytes: uploadLimit });
  if (tooLarge) return tooLarge;
  const contentType = file.type || "application/octet-stream";
  try {
    const pre = await fileApi.presign({ filename: file.name, contentType, purpose: options?.purpose });
    if (pre.success && pre.data?.direct && pre.data.uploadUrl && pre.data.key) {
      const put = await http.putProgress(pre.data.uploadUrl, file, { "Content-Type": pre.data.contentType || contentType }, onProgress);
      if (put.ok) {
        return fileApi.register({ key: pre.data.key, originalName: file.name, contentType });
      }
      // 鐩翠紶 PUT 澶辫触锛堝涓?OSS 妗舵湭閰?CORS锛屾祻瑙堝櫒棰勬琚嫤锛夆啋 涓嶆姤閿欙紝钀藉埌涓嬫柟鏈嶅姟鍣ㄤ腑杞笂浼狅紝淇濊瘉涓婁紶濮嬬粓鍙敤銆?
      // 濡傞渶鍚敤鐩翠紶(鐪佸悗绔甫瀹?澶ф枃浠跺弸濂?锛岃涓?OSS 妗堕厤缃?CORS锛氭潵婧?绔欑偣鍩熷悕锛屾柟娉?PUT/GET/HEAD锛屽厑璁稿ご=*锛屾毚闇插ご=ETag銆?
    }
  } catch {
    // presign 寮傚父 鈫?鍥為€€涓浆涓婁紶
  }
  if (options?.purpose === "conversation") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "conversation");
    return http.uploadProgress<FileVO>("/api/files/upload", formData, onProgress);
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
    activeUsers: () =>
      http.get<ActiveUserVO[]>("/api/admin/dashboard/active-users"),
  },
  monitor: {
    system: () => http.get<SystemMetricsVO>("/api/admin/monitor/system"),
    redis: () => http.get<RedisInfoVO>("/api/admin/monitor/redis"),
    sessions: () => http.get<SessionVO[]>("/api/admin/monitor/sessions"),
  },
  roles: {
    list: () => http.get<RoleVO[]>("/api/admin/roles"),
    catalog: () => http.get<PermissionGroup[]>("/api/admin/roles/catalog"),
    myPermissions: () => http.get<string[]>("/api/admin/roles/my-permissions"),
    create: (data: RoleSaveDTO) => http.post<void>("/api/admin/roles", data),
    update: (id: string, data: RoleSaveDTO) => http.put<void>(`/api/admin/roles/${id}`, data),
    remove: (id: string) => http.delete<void>(`/api/admin/roles/${id}`),
  },
  users: {
    list: (query: AdminUserQuery) =>
      http.get<PageResult<AdminUserVO>["data"]>("/api/admin/users", toParams(query)),
    get: (id: string) =>
      http.get<AdminUserVO>(`/api/admin/users/${id}`),
    create: (data: AdminUserCreateDTO) =>
      http.post<AdminUserVO>("/api/admin/users", data),
    update: (id: string, data: AdminUserUpdateDTO) =>
      http.put<void>(`/api/admin/users/${id}`, data),
    resetPassword: (id: string, data: AdminUserPasswordResetDTO) =>
      http.post<void>(`/api/admin/users/${id}/password`, data),
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
    update: (id: string, data: BannerUpdateDTO) =>
      http.put<void>(`/api/admin/banners/${id}`, data),
    delete: (id: string) =>
      http.delete<void>(`/api/admin/banners/${id}`),
  },
  styles: {
    list: (query: StylePresetQuery) =>
      http.get<PageResult<StylePresetVO>["data"]>("/api/admin/styles", toParams(query)),
    create: (data: StylePresetSaveDTO) =>
      http.post<StylePresetVO>("/api/admin/styles", data),
    update: (id: string, data: StylePresetSaveDTO) =>
      http.put<void>(`/api/admin/styles/${id}`, data),
    delete: (id: string) =>
      http.delete<void>(`/api/admin/styles/${id}`),
  },
  ai: {
    providers: {
      list: () => http.get<AiProviderVO[]>("/api/admin/ai/providers"),
      create: (data: AiProviderCreateDTO) => http.post<AiProviderVO>("/api/admin/ai/providers", data),
      update: (id: string, data: AiProviderUpdateDTO) => http.put<void>(`/api/admin/ai/providers/${id}`, data),
      delete: (id: string) => http.delete<void>(`/api/admin/ai/providers/${id}`),
      // 浠庝緵搴斿晢鎺ュ彛鎷夊彇鍙敤妯″瀷 ID 鍒楄〃锛坕d 涓洪洩鑺遍暱鏁村瀷瀛楃涓诧級锛況unware 渚涘簲鍟嗘敮鎸?search 鍏抽敭璇?
      remoteModels: (id: string, search?: string) =>
        http.get<string[]>(`/api/admin/ai/providers/${id}/models${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    },
    models: {
      list: () => http.get<AiModelVO[]>("/api/admin/ai/models"),
      create: (data: Record<string, unknown>) => http.post<AiModelVO>("/api/admin/ai/models", data),
      update: (id: string | number, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/models/${id}`, data),
      delete: (id: string | number) => http.delete<void>(`/api/admin/ai/models/${id}`),
    },
    icons: {
      list: () => http.get<AiIconAssetVO[]>("/api/admin/ai/icons"),
      create: (data: Record<string, unknown>) => http.post<AiIconAssetVO>("/api/admin/ai/icons", data),
      update: (id: string | number, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/icons/${id}`, data),
      delete: (id: string | number) => http.delete<void>(`/api/admin/ai/icons/${id}`),
    },
    upstreamModels: {
      list: () => http.get<AiUpstreamModelVO[]>("/api/admin/ai/upstream-models"),
      create: (data: Record<string, unknown>) => http.post<AiUpstreamModelVO>("/api/admin/ai/upstream-models", data),
      update: (id: string | number, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/upstream-models/${id}`, data),
      delete: (id: string | number) => http.delete<void>(`/api/admin/ai/upstream-models/${id}`),
    },
    modelRoutes: {
      list: (modelId: string | number) => http.get<AiModelRouteVO[]>(`/api/admin/ai/models/${modelId}/routes`),
      create: (modelId: string | number, data: Record<string, unknown>) => http.post<AiModelRouteVO>(`/api/admin/ai/models/${modelId}/routes`, data),
      update: (id: string | number, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/routes/${id}`, data),
      delete: (id: string | number) => http.delete<void>(`/api/admin/ai/routes/${id}`),
    },
    routeDecisions: {
      list: (query: PageQuery) => http.get<PageData<AiRouteDecisionLogVO>>("/api/admin/ai/route-decisions", toParams(query)),
    },
    handlers: {
      list: () => http.get<AiHandlerVO[]>("/api/admin/ai/handlers"),
      update: (name: string, data: Record<string, unknown>) => http.put<void>(`/api/admin/ai/handlers/${name}`, data),
    },
    logs: {
      list: (query: AiGenerationLogQuery) =>
        http.get<PageData<AiGenerationLogVO>>("/api/admin/ai/logs", toParams(query)),
      get: (id: number) => http.get<AiGenerationLogVO>(`/api/admin/ai/logs/${id}`),
      // 褰撳墠绛涢€夋潯浠朵笅鐨勪笂娓告垚鏈眹鎬伙紙USD锛?
      costSum: (query: AiGenerationLogQuery) =>
        http.get<number>("/api/admin/ai/logs/cost-sum", toParams(query)),
    },
  },
  redeem: {
    generate: (data: GenerateRedeemDTO) => http.post<string[]>("/api/admin/redeem/generate", data),
    list: (query: RedeemCodeQuery) => http.get<PageData<RedeemCodeVO>>("/api/admin/redeem", toParams(query)),
    updateStatus: (id: string, status: number) => http.put<void>(`/api/admin/redeem/${id}/status`, { status }),
    delete: (id: string) => http.delete<void>(`/api/admin/redeem/${id}`),
  },
  settings: {
    get: () => http.get<Record<string, unknown>>("/api/admin/settings"),
    update: (data: Record<string, unknown>) => http.put<void>("/api/admin/settings", data),
  },
  vipLevels: {
    list: () => http.get<VipLevelVO[]>("/api/admin/vip-levels"),
    save: (data: VipLevelVO[]) => http.put<void>("/api/admin/vip-levels", data),
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
    remove: (id: number) => http.delete<void>(`/api/admin/logs/${id}`),
    clear: () => http.delete<void>("/api/admin/logs"),
  },
  accessLogs: {
    list: (query: AccessLogQuery) =>
      http.get<PageResult<AccessLogVO>["data"]>("/api/admin/access-logs", toParams(query)),
    remove: (id: number) => http.delete<void>(`/api/admin/access-logs/${id}`),
    clear: () => http.delete<void>("/api/admin/access-logs"),
  },
  loginLogs: {
    list: (query: LoginLogQuery) =>
      http.get<PageResult<LoginLogVO>["data"]>("/api/admin/login-logs", toParams(query)),
    remove: (id: number) => http.delete<void>(`/api/admin/login-logs/${id}`),
    clear: () => http.delete<void>("/api/admin/login-logs"),
  },
  points: {
    transactions: (query: PointsTransactionQuery) =>
      http.get<PageData<PointsTransactionVO>>("/api/admin/points/transactions", toParams(query)),
    adjust: (data: { userId: string; amount: number; remark?: string }) =>
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
    grant: (userId: string) =>
      http.post<void>(`/api/admin/authors/${userId}/grant`),
    revoke: (userId: string) =>
      http.post<void>(`/api/admin/authors/${userId}/revoke`),
  },
  orders: {
    list: (query: AdminOrderQuery) =>
      http.get<PageData<RechargeOrderVO>>("/api/admin/orders", toParams(query)),
    get: (id: string) =>
      http.get<RechargeOrderVO>(`/api/admin/orders/${id}`),
    pay: (id: string) =>
      http.post<void>(`/api/admin/orders/${id}/pay`),
  },
};

// ========== 绉垎 ==========
export const pointsApi = {
  balance: () =>
    http.get<PointsBalanceVO>("/api/points/balance"),
  transactions: (query: PointsTransactionQuery) =>
    http.get<PageData<PointsTransactionVO>>("/api/points/transactions", toParams(query)),
};

// ========== 绛惧埌 ==========
export const checkinApi = {
  checkin: () =>
    http.post<CheckinStatusVO>("/api/checkin"),
  status: () =>
    http.get<CheckinStatusVO>("/api/checkin/status"),
  calendar: (year: number, month: number) =>
    http.get<CheckinCalendarVO>("/api/checkin/calendar", { year, month }),
};

// ========== 绀惧尯甯栧瓙 ==========
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

// ========== 鍗氬 ==========
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

// ========== 鍏虫敞锛堥€氱煡绯荤粺鍓嶇疆锛?==========
export const followApi = {
  /** 鍏虫敞瀵规柟锛坲serId 涓哄鏂?public_id锛?*/
  follow: (userId: string) =>
    http.post<void>(`/api/follow/${userId}`),
  /** 鍙栧叧 */
  unfollow: (userId: string) =>
    http.delete<void>(`/api/follow/${userId}`),
  /** 鍏虫敞鐘舵€?{following, followedBy} */
  status: (userId: string) =>
    http.get<FollowStatusVO>(`/api/follow/${userId}/status`),
  /** 鎴戝叧娉ㄧ殑浜猴紙鍒嗛〉锛?*/
  following: (query?: FollowQuery) =>
    http.get<PageData<FollowUserVO>>("/api/follow/following", toParams(query ?? {})),
  /** 鍏虫敞鎴戠殑浜猴紙鍒嗛〉锛?*/
  followers: (query?: FollowQuery) =>
    http.get<PageData<FollowUserVO>>("/api/follow/followers", toParams(query ?? {})),
};

// ========== 閫氱煡锛堢珯鍐呴€氱煡锛岄渶鐧诲綍锛?==========
export const notificationApi = {
  /** 閫氱煡鍒楄〃锛堝垎椤碉紝鍙寜 type 杩囨护锛?*/
  list: (query?: NotificationQuery) =>
    http.get<PageData<NotificationVO>>("/api/notifications", toParams(query ?? {})),
  /** 鏈閫氱煡鏁?{count} */
  unreadCount: () =>
    http.get<UnreadCountVO>("/api/notifications/unread-count"),
  /** 鏍囪鎸囧畾閫氱煡涓哄凡璇?*/
  markRead: (ids: number[]) =>
    http.post<void>("/api/notifications/read", { ids }),
  /** 鍏ㄩ儴鏍囪涓哄凡璇?*/
  markAllRead: () =>
    http.post<void>("/api/notifications/read-all"),
};

// ========== Banner锛堥椤佃疆鎾紝鍏紑锛?==========
export const bannerApi = {
  list: () => http.get<BannerVO[]>("/api/banners"),
};

// ========== 璁㈠崟 ==========
export const orderApi = {
  create: (data: RechargeCreateDTO) =>
    http.post<RechargeOrderVO>("/api/orders/recharge", data),
  list: (query: OrderQuery) =>
    http.get<PageData<RechargeOrderVO>>("/api/orders", toParams(query)),
  get: (id: string) =>
    http.get<RechargeOrderVO>(`/api/orders/${id}`),
  cancel: (id: string) =>
    http.post<void>(`/api/orders/${id}/cancel`),
  rechargeConfig: () =>
    http.get<RechargeConfigVO>("/api/orders/recharge-config"),
  pay: (id: string, payType?: string) =>
    http.post<PaymentInitiateVO>(`/api/orders/${id}/pay`, payType ? { payType } : {}),
  sync: (id: string) =>
    http.post<RechargeOrderVO>(`/api/orders/${id}/sync`),
};

export const imApi = {
  // ---- 浼氳瘽 ----
  conversations: (type?: ConversationType, page?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<ConversationVO>>("/api/im/conversations", toParams({ type, ...(page ?? {}) })),
  openPrivate: (peerId: string) =>
    http.post<ConversationVO>("/api/im/conversations/private", { peerId }),
  openSupport: () =>
    http.post<ConversationVO>("/api/im/conversations/support"),
  openStaff: (data: OpenStaffDTO) =>
    http.post<ConversationVO>("/api/im/conversations/staff", data),
  // ---- 娑堟伅 ----
  messages: (conversationId: string, params?: { before?: string; limit?: number }) =>
    http.get<MessageVO[]>(`/api/im/conversations/${conversationId}/messages`, toParams(params ?? {})),
  send: (data: SendMessageDTO) =>
    http.post<MessageVO>("/api/im/messages", data),
  markRead: (conversationId: string, lastReadMessageId?: string) =>
    http.post<void>("/api/im/messages/read", { conversationId, lastReadMessageId }),
  recall: (messageId: string) =>
    http.post<void>(`/api/im/messages/${messageId}/recall`),
  // ---- 鍦ㄧ嚎鐘舵€?----
  status: (ids: string[]) =>
    http.get<UserStatusVO[]>("/api/im/status", { ids: ids.join(",") }),
  // ---- 瀹㈡湇鍙帮紙绠＄悊鍛橈級----
  supportWaiting: (page?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<ConversationVO>>("/api/im/support/waiting", toParams(page ?? {})),
  supportAccept: (conversationId: string) =>
    http.post<ConversationVO>(`/api/im/support/${conversationId}/accept`),
};
