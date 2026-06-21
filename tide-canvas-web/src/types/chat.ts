// Chat (对话 / IM) types — mirror the backend chat VOs at
// tide-canvas-server/internal/handler/chat/vo.go + dto.go.
//
// All id / FK fields are serialized by the backend as quoted decimal strings
// (idgen.ID), so they are typed as `string` here. JSON is camelCase.

/** A message role surfaced to the frontend. Derived server-side: a message from
 *  the conversation owner is "user"; the placeholder assistant is "ai". */
export type ChatRole = "user" | "ai";

/** Content type of a message. Backend defaults to "text". */
export type ChatContentType = "text" | "image" | "file";

/** Summary view of a conversation (GET/POST /api/im/conversations). */
export interface ConversationVO {
  id: string;
  title: string;
  /** RFC3339, or "" when the conversation has no messages yet. */
  lastMessageAt: string;
  createTime: string;
}

/** A single message within a conversation. */
export interface MessageVO {
  id: string;
  conversationId: string;
  role: ChatRole;
  contentType: string;
  content: string;
  createTime: string;
}

/** Body for POST /api/im/conversations. Title is optional. */
export interface CreateConversationDTO {
  title?: string;
}

/** Body for POST /api/im/conversations/:id/messages. Type defaults to "text". */
export interface SendMessageDTO {
  content: string;
  type?: ChatContentType;
}
