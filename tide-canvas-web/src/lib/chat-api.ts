// Chat (对话 / IM) API module — mirrors the structure of src/lib/api.ts.
// All endpoints are authenticated; callers must run
// useAuthStore.getState().ensureSession() before invoking these.
//
// Backend routes (tide-canvas-server/internal/handler/chat/register.go):
//   GET    /api/im/conversations                     -> PageData<ConversationVO>
//   POST   /api/im/conversations  {title?}           -> ConversationVO
//   PUT    /api/im/conversations/:id  {title}        -> ConversationVO (rename)
//   DELETE /api/im/conversations/:id                 -> void
//   GET    /api/im/conversations/:id/messages        -> PageData<MessageVO>
//   POST   /api/im/conversations/:id/messages {content,type?,attachments?} -> MessageVO
//   POST   /api/im/conversations/:id/messages/append {role,content,type?} -> MessageVO
//   POST   /api/im/conversations/:id/turn  {prompt,params,taskId} -> MessageVO[]
//   GET    /api/im/conversations/:id/context         -> ContextUsageVO
//   POST   /api/im/conversations/:id/stream  (SSE)   -> delta/done/error frames
//   GET    /api/im/conversations/:id/stream  (SSE)   -> 断线重连续播

import { http, toParams, refreshTokenOnce, getAccessToken } from "./http";
import type { PageData } from "@/types/api";
import type {
  ConversationVO,
  ContextUsageVO,
  MessageVO,
  CreateConversationDTO,
  SendMessageDTO,
  MessageAttachment,
} from "@/types/chat";

export type { MessageAttachment };

/** SSE 流式 fetch，带一次 401 刷新重试。http.request 的 Result 信封封装不适用
 *  流式响应（要拿裸 Response 读 body reader），这里复用同一个单飞刷新：
 *  access token 过期时长对话不再直接报"网络错误"，而是静默续期后重发；
 *   refresh 被明确拒绝（凭据已清）则与 http.request 同口径跳登录。 */
async function fetchStream(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const send = (token: string | null) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });
  const token = getAccessToken();
  let res = await send(token);
  if (res.status === 401 && token) {
    const newToken = await refreshTokenOnce();
    if (newToken) {
      res = await send(newToken);
    } else if (!getAccessToken() && typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }
  return res;
}

/** Consume the SSE stream from POST /api/im/conversations/:id/stream. Each frame
 *  is a JSON object: {delta} per token, {done,message} at the end, or
 *  {error,code?} — code "CONTEXT_LIMIT" means the conversation hit the context
 *  cap and the user should start a new one.
 *  Pass an AbortSignal to cancel (switching conversation / leaving the page). */
export async function streamMessage(
  id: string,
  content: string,
  handlers: {
    onDelta?: (delta: string) => void;
    onDone?: (message: MessageVO) => void;
    onError?: (msg: string, code?: string) => void;
    signal?: AbortSignal;
    attachments?: MessageAttachment[];
    /** Upstream model_key of the composer's selected text model; the server
     *  validates it against 模型管理 and falls back to the primary text model. */
    model?: string;
    /** Optional public preset. The server resolves its template and defaults. */
    skillId?: string;
  },
): Promise<void> {
  let res: Response;
  try {
    res = await fetchStream(
      `/api/im/conversations/${id}/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          ...(handlers.attachments?.length ? { attachments: handlers.attachments } : {}),
          ...(handlers.model ? { model: handlers.model } : {}),
          ...(handlers.skillId ? { skillId: handlers.skillId } : {}),
        }),
      },
      handlers.signal,
    );
  } catch {
    // 主动中止（切会话/离开页面）不是错误，别对用户弹"网络错误"假警报。
    if (!handlers.signal?.aborted) handlers.onError?.("网络错误");
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError?.(res.status === 401 ? "登录状态已过期，请重新登录" : "网络错误");
    return;
  }
  const terminal = await readSseFrames(res, (obj) => {
    if (typeof obj.delta === "string") {
      handlers.onDelta?.(obj.delta);
      return false;
    }
    if (obj.done) {
      handlers.onDone?.(obj.message as MessageVO);
      return true;
    }
    if (obj.error) {
      handlers.onError?.(String(obj.error), typeof obj.code === "string" ? obj.code : undefined);
      return true;
    }
    return false;
  });
  // 没收到终结帧就结束 = 连接中途断掉（网络抖动 / 服务端崩溃），必须通知
  // 调用方——否则回复静默消失、界面毫无解释。
  if (!terminal && !handlers.signal?.aborted) {
    handlers.onError?.("连接中断，回复可能不完整，请查看最新消息或重试");
  }
}

/** Attach to the conversation's in-progress assistant reply（断开重连续播,
 *  GET /stream）: the server first replays the already-generated snapshot as a
 *  delta, then live deltas, then the same {done,message} terminal frame as
 *  POST /stream. onNone fires when nothing is generating（回复已落库 / 从未
 *  开始 / 服务端重启）—— caller should reload messages instead. */
export async function streamLive(
  id: string,
  handlers: {
    onDelta?: (delta: string) => void;
    onDone?: (message: MessageVO) => void;
    onNone?: () => void;
    onError?: (msg: string) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  let res: Response;
  try {
    res = await fetchStream(
      `/api/im/conversations/${id}/stream`,
      { method: "GET" },
      handlers.signal,
    );
  } catch {
    if (!handlers.signal?.aborted) handlers.onError?.("网络错误");
    return;
  }
  if (!res.ok || !res.body) {
    handlers.onError?.(res.status === 401 ? "登录状态已过期，请重新登录" : "网络错误");
    return;
  }
  const terminal = await readSseFrames(res, (obj) => {
    if (typeof obj.delta === "string") {
      handlers.onDelta?.(obj.delta);
      return false;
    }
    if (obj.none) {
      handlers.onNone?.();
      return true;
    }
    if (obj.done) {
      handlers.onDone?.(obj.message as MessageVO);
      return true;
    }
    if (obj.error) {
      handlers.onError?.(String(obj.error));
      return true;
    }
    return false;
  });
  if (!terminal && !handlers.signal?.aborted) handlers.onError?.("连接中断");
}

/** 逐帧消费 SSE 响应体。onFrame 对终结帧返回 true；整体返回是否见到终结帧
 *  （中止/断流时为 false，由调用方决定如何提示）。 */
async function readSseFrames(
  res: Response,
  onFrame: (obj: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false;
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
          if (onFrame(JSON.parse(line.slice(5).trim()))) terminal = true;
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch {
    // read threw: an abort (caller-initiated) or a mid-stream network drop —
    // both surface to the caller via the terminal flag.
  }
  return terminal;
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

  /** Estimated context-token usage of a conversation vs the server cap. */
  contextUsage: (id: string) =>
    http.get<ContextUsageVO>(`/api/im/conversations/${id}/context`),

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
      contentType?: "image" | "video" | "audio";
    },
  ) =>
    http.post<MessageVO[]>(`/api/im/conversations/${id}/turn`, {
      prompt: data.prompt,
      params: data.params ?? {},
      taskId: String(data.taskId),
      ...(data.contentType ? { contentType: data.contentType } : {}),
    }),
};
