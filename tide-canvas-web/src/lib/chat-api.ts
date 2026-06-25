// Chat (对话 / IM) API module — mirrors the structure of src/lib/api.ts.
// All endpoints are authenticated; callers must run
// useAuthStore.getState().ensureSession() before invoking these.
//
// Backend routes (tide-canvas-server/internal/handler/chat/register.go):
//   GET    /api/im/conversations               -> PageData<ConversationVO>
//   POST   /api/im/conversations  {title?}      -> ConversationVO
//   GET    /api/im/conversations/:id/messages   -> PageData<MessageVO>
//   POST   /api/im/conversations/:id/messages {content,type?} -> MessageVO

import { http, toParams } from "./http";
import type { PageData } from "@/types/api";
import type {
  ConversationVO,
  MessageVO,
  CreateConversationDTO,
  SendMessageDTO,
} from "@/types/chat";

export const chatApi = {
  /** List the current user's conversations (paged, newest first server-side). */
  conversations: (params?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<ConversationVO>>("/api/im/conversations", toParams(params ?? {})),

  /** Create a new conversation; blank title → server assigns a default. */
  createConversation: (data: CreateConversationDTO = {}) =>
    http.post<ConversationVO>("/api/im/conversations", data),

  /** Load the message history for a conversation (paged). */
  messages: (id: string, params?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<MessageVO>>(
      `/api/im/conversations/${id}/messages`,
      toParams(params ?? {}),
    ),

  /** Send a user message; the backend appends a canned assistant reply. Returns
   *  the persisted user MessageVO. */
  send: (id: string, content: string, type?: SendMessageDTO["type"]) =>
    http.post<MessageVO>(`/api/im/conversations/${id}/messages`, {
      content,
      ...(type ? { type } : {}),
    } satisfies SendMessageDTO),

  /** Append one message verbatim with NO auto reply — used by 对话式生成 to log
   *  the user's prompt and the generated media (image/video) result. */
  append: (
    id: string,
    content: string,
    role: "user" | "ai",
    type: "text" | "image" | "video" | "file" = "text",
  ) =>
    http.post<MessageVO>(`/api/im/conversations/${id}/messages/append`, {
      role,
      content,
      type,
    }),

  /** Persist a completed 生成台 turn: the user prompt + its param snapshot + the
   *  generation task. The assistant message stores only taskId (task = source of
   *  truth). Returns [userMessage, assistantMessage]. */
  persistTurn: (
    id: string,
    data: {
      prompt: string;
      params?: Record<string, unknown>;
      taskId: string | number;
      contentType?: "image" | "video";
    },
  ) =>
    http.post<MessageVO[]>(`/api/im/conversations/${id}/turn`, {
      prompt: data.prompt,
      params: data.params ?? {},
      taskId: String(data.taskId),
      ...(data.contentType ? { contentType: data.contentType } : {}),
    }),
};
