// ============================================================================
// Admin · AI 聊天供应商 API — 对应 internal/handler/admin/g3_chat_providers.go
// 与 g3_chat_models.go，挂在 /api/admin 之下、与模型管理同一权限键。
// ============================================================================

import { http } from "@/lib/http";
import type {
  ChatEndpointDTO,
  ChatFetchResult,
  ChatModelDTO,
  ChatProviderDTO,
  ChatProviderVO,
} from "@/types/admin-chat-providers";

export const adminChatProvidersApi = {
  list: () => http.get<ChatProviderVO[]>("/api/admin/chat-providers"),

  createProvider: (dto: ChatProviderDTO) =>
    http.post<{ id: string }>("/api/admin/chat-providers", dto),
  updateProvider: (id: string, dto: ChatProviderDTO) =>
    http.put<{ ok: boolean }>(`/api/admin/chat-providers/${id}`, dto),
  deleteProvider: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/chat-providers/${id}`),

  createEndpoint: (providerId: string, dto: ChatEndpointDTO) =>
    http.post<{ id: string }>(`/api/admin/chat-providers/${providerId}/endpoints`, dto),
  updateEndpoint: (id: string, dto: ChatEndpointDTO) =>
    http.put<{ ok: boolean }>(`/api/admin/chat-endpoints/${id}`, dto),
  deleteEndpoint: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/chat-endpoints/${id}`),

  /** 从供应商拉取 /v1/models；新模型默认未开放、未定价。 */
  fetchModels: (providerId: string) =>
    http.post<ChatFetchResult>(`/api/admin/chat-providers/${providerId}/fetch-models`, {}),
  updateModel: (id: string, dto: ChatModelDTO) =>
    http.put<{ ok: boolean }>(`/api/admin/chat-models/${id}`, dto),
  /** 让这一行成为同名模型的首选供应商；其余同名行按原顺序排在后面作备用。 */
  preferModel: (id: string) =>
    http.post<{ ok: boolean }>(`/api/admin/chat-models/${id}/prefer`, {}),
  deleteModel: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/chat-models/${id}`),
};
