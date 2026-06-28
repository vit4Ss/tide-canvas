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
  MessageAttachment,
} from "@/types/chat";

export type { MessageAttachment };

/** Consume the SSE stream from POST /api/im/conversations/:id/stream. Each frame
 *  is a JSON object: {delta} per token, {done,message} at the end, or {error}.
 *  Pass an AbortSignal to cancel (switching conversation / leaving the page). */
export async function streamMessage(
  id: string,
  content: string,
  handlers: {
    onDelta?: (delta: string) => void;
    onDone?: (message: MessageVO) => void;
    onError?: (msg: string) => void;
    signal?: AbortSignal;
    attachments?: MessageAttachment[];
  },
): Promise<void> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  let res: Response;
  try {
    res = await fetch(`/api/im/conversations/${id}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        content,
        ...(handlers.attachments?.length ? { attachments: handlers.attachments } : {}),
      }),
      signal: handlers.signal,
    });
  } catch {
    handlers.onError?.("网络错误");
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError?.("网络错误");
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const obj = JSON.parse(line.slice(5).trim());
          if (typeof obj.delta === "string") handlers.onDelta?.(obj.delta);
          else if (obj.done) handlers.onDone?.(obj.message as MessageVO);
          else if (obj.error) handlers.onError?.(String(obj.error));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch {
    // aborted or network drop mid-stream; caller handles via onError/abort.
  }
}

export const chatApi = {
  /** List the current user's conversations (paged, newest first server-side). */
  conversations: (params?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<ConversationVO>>("/api/im/conversations", toParams(params ?? {})),

  /** Create a new conversation; blank title → server assigns a default. */
  createConversation: (data: CreateConversationDTO = {}) =>
    http.post<ConversationVO>("/api/im/conversations", data),

  /** Rename a conversation. Returns the updated ConversationVO. */
  renameConversation: (id: string, title: string) =>
    http.put<ConversationVO>(`/api/im/conversations/${id}`, { title }),

  /** Delete a conversation (and its messages). */
  deleteConversation: (id: string) => http.delete<void>(`/api/im/conversations/${id}`),

  /** Load the message history for a conversation (paged). */
  messages: (id: string, params?: { pageNum?: number; pageSize?: number }) =>
    http.get<PageData<MessageVO>>(
      `/api/im/conversations/${id}/messages`,
      toParams(params ?? {}),
    ),

  /** Send a user message; the backend appends a canned assistant reply. Returns
   *  the persisted user MessageVO. Image attachments are forwarded to the model. */
  send: (id: string, content: string, type?: SendMessageDTO["type"], attachments?: MessageAttachment[]) =>
    http.post<MessageVO>(`/api/im/conversations/${id}/messages`, {
      content,
      ...(type ? { type } : {}),
      ...(attachments?.length ? { attachments } : {}),
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
