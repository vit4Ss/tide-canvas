// Chat (对话 / IM) types — mirror the backend chat VOs at
// tide-canvas-server/internal/handler/chat/vo.go + dto.go.
//
// All id / FK fields are serialized by the backend as quoted decimal strings
// (idgen.ID), so they are typed as `string` here. JSON is camelCase.

import type { SkillRunStatus } from "@/types/skill-run";

/** A message role surfaced to the frontend. Derived server-side: a message from
 *  the conversation owner is "user"; the placeholder assistant is "ai". */
export type ChatRole = "user" | "ai";

/** Content type of a message. Backend defaults to "text". */
export type ChatContentType = "text" | "image" | "video" | "audio" | "file" | "skill_run";

/** Summary view of a conversation (GET/POST /api/im/conversations). */
export interface ConversationVO {
  id: string;
  title: string;
  /** RFC3339, or "" when the conversation has no messages yet. */
  lastMessageAt: string;
  createTime: string;
}

/** Live status/result of the generation task an assistant message points to.
 *  The task is the single source of truth; the message stores only its id. */
export interface MessageTaskVO {
  id: string;
  /** 0 processing · 1 success · 2 failed · 3 cancelled */
  status: number;
  progress: number;
  /** 生成所用模型的显示名 —— 结果气泡的头像显示该模型图标。 */
  modelName?: string;
  resultUrl: string;
  resultMeta?: Record<string, unknown> | string;
  errorMsg: string;
}

/** Compact run state joined in the message list. Full steps/artifacts are read
 * from /api/skill-runs/:id so listing a long conversation stays bounded. */
export interface MessageSkillRunVO {
  id: string;
  skillId: string;
  status: SkillRunStatus;
  currentStep?: string;
  progress: number;
  pendingAction?: Record<string, unknown> | string | null;
  errorMessage?: string;
  pointCost: number;
}

/** A single message within a conversation. 生成台 assistant messages carry a
 *  `task` (live status, null when the task expired); the user message of a turn
 *  carries the `params` snapshot used for the detail row / 重新编辑 / 再次生成. */
export interface MessageVO {
  id: string;
  conversationId: string;
  role: ChatRole;
  contentType: string;
  content: string;
  createTime: string;
  taskId?: string;
  skillRunId?: string;
  clientRequestId?: string;
  params?: Record<string, unknown>;
  task?: MessageTaskVO;
  skillRun?: MessageSkillRunVO;
}

/** Estimated context-token usage of a conversation vs the server cap
 *  (GET /api/im/conversations/:id/context). `full` means the server will
 *  reject new text turns — the user should start a new conversation.
 *  `compressed`：较早对话已被服务端自动压缩成摘要（usedTokens 按
 *  摘要+未压缩尾部计，不再是原始全文）。 */
export interface ContextUsageVO {
  usedTokens: number;
  limitTokens: number;
  /** 0–100, clamped. */
  percent: number;
  full: boolean;
  compressed: boolean;
}

/** Body for POST /api/im/conversations. Title is optional. */
export interface CreateConversationDTO {
  title?: string;
}

/** A composer attachment forwarded with a chat message. Image attachments are
 *  sent to the model as multimodal content; all kinds are persisted for display. */
export interface MessageAttachment {
  url: string;
  kind: "image" | "video" | "audio" | "file";
}

/** Body for POST /api/im/conversations/:id/messages (and /stream). Type defaults
 *  to "text"; attachments are optional reference files. */
export interface SendMessageDTO {
  content: string;
  type?: ChatContentType;
  attachments?: MessageAttachment[];
  clientRequestId?: string;
  /** Upstream model_key of the selected text model (validated server-side). */
  model?: string;
}
