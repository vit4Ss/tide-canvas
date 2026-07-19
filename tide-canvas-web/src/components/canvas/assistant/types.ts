import type { FileVO } from "@/types/file";

export type AssistantChatRole = "user" | "assistant";
export type AssistantChatStatus = "done" | "pending" | "error";

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  attachments?: FileVO[];
  status: AssistantChatStatus;
}

export interface AssistantStoredSession {
  id: string;
  title: string;
  messages: AssistantChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AssistantStoredSessionsPayload {
  sessions: AssistantStoredSession[];
  activeSessionId?: string;
}
