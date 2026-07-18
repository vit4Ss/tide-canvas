import type { FileVO } from "./file";

export type CreationMode = "text" | "image" | "video";
export type ConversationMessageRole = "user" | "assistant" | "system";
export type ConversationMessageStatus = "pending" | "streaming" | "done" | "error" | "cancelled";
export type ConversationContentType = "text" | "image" | "video" | "status";

export interface ConversationMessageFile extends Omit<FileVO, "id"> {
  id: string;
  relation: "attachment" | "result" | "reference";
  locator?: Record<string, unknown>;
}

export interface ConversationMessageVO {
  id: string;
  parentMessageId?: string;
  role: ConversationMessageRole;
  contentType: ConversationContentType;
  content: string;
  modelId?: string;
  modelName?: string;
  taskId?: string;
  status: ConversationMessageStatus;
  metadata?: Record<string, unknown>;
  files: ConversationMessageFile[];
  createTime: string;
  updateTime: string;
}

export interface CreationConversationVO {
  id: string;
  mode: CreationMode;
  title: string;
  pinned: boolean;
  activeLeafMessageId?: string;
  lastMessageTime?: string;
  createTime: string;
  updateTime: string;
  messages?: ConversationMessageVO[];
}

export interface ConversationMessageFileDTO {
  fileId: string;
  relation?: "attachment" | "result" | "reference";
  locator?: Record<string, unknown>;
}

export interface AppendConversationMessageDTO {
  parentMessageId?: string;
  role: ConversationMessageRole;
  contentType?: ConversationContentType;
  content: string;
  modelId?: string;
  modelName?: string;
  taskId?: string;
  status?: ConversationMessageStatus;
  metadata?: Record<string, unknown>;
  files?: ConversationMessageFileDTO[];
}

export interface UpdateConversationMessageDTO {
  content?: string;
  status?: ConversationMessageStatus;
  modelId?: string;
  modelName?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export const CONVERSATIONS_CHANGED_EVENT = "tc:conversations:changed";
export const NEW_CREATION_EVENT = "tc:creation:new";

export function notifyConversationsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT));
}
