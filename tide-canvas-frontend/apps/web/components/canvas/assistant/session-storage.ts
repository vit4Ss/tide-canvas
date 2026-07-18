import { MAX_STORED_MESSAGES, MAX_STORED_SESSIONS } from "./constants";
import type { AssistantChatMessage, AssistantStoredSession, AssistantStoredSessionsPayload } from "./types";

const ASSISTANT_SESSION_STORAGE_KEY = "tc:assistant:session";
const ASSISTANT_SESSIONS_STORAGE_KEY = "tc:assistant:sessions";
const ASSISTANT_ACTIVE_SESSION_STORAGE_KEY = "tc:assistant:activeSessionId";

function attachmentSummary(files?: AssistantChatMessage["attachments"]) {
  if (!files?.length) return "";
  return files
    .map((file) => {
      const parts = [file.originalName || "未命名文件"];
      if (file.mimeType) parts.push("(" + file.mimeType + ")");
      if (file.fileUrl) parts.push(file.fileUrl);
      return "- " + parts.join(" ");
    })
    .join("\n");
}

export function messageContentForHistory(item: AssistantChatMessage) {
  const summary = attachmentSummary(item.attachments);
  return summary ? item.content + "\n\n附件：\n" + summary : item.content;
}

export function normalizeStoredMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .filter((item) => item.content.trim() || item.attachments?.length)
    .map((item) => ({
      ...item,
      // 页面刷新后无法恢复未完成轮询，明确标记为中断，避免假装还在生成。
      status: item.status === "pending" ? "error" as const : item.status,
      content: item.status === "pending" ? "上次回复中断，请重新发送。" : item.content,
    }))
    .slice(-MAX_STORED_MESSAGES);
}

export function createSessionId() {
  return "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeSessionTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.length > 18 ? title.slice(0, 18) + "..." : title;
}

export function sessionTitleFromMessages(messages: AssistantChatMessage[]) {
  const firstUserMessage = messages.find((item) => item.role === "user" && (item.content.trim() || item.attachments?.length));
  const contentTitle = normalizeSessionTitle(firstUserMessage?.content ?? "");
  if (contentTitle) return contentTitle;
  const attachmentName = firstUserMessage?.attachments?.[0]?.originalName;
  return attachmentName ? normalizeSessionTitle("附件 " + attachmentName) : "未命名会话";
}

function normalizeStoredSessions(value: unknown): AssistantStoredSession[] {
  if (!Array.isArray(value)) return [] as AssistantStoredSession[];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const session = item as Partial<AssistantStoredSession>;
      const messages = normalizeStoredMessages(Array.isArray(session.messages) ? session.messages : []);
      if (!messages.length) return null;
      const updatedAt = Number.isFinite(session.updatedAt) ? Number(session.updatedAt) : Date.now();
      const createdAt = Number.isFinite(session.createdAt) ? Number(session.createdAt) : updatedAt;
      return {
        id: typeof session.id === "string" && session.id.trim() ? session.id : createSessionId(),
        title: normalizeSessionTitle(typeof session.title === "string" ? session.title : "") || sessionTitleFromMessages(messages),
        messages,
        createdAt,
        updatedAt,
      } satisfies AssistantStoredSession;
    })
    .filter((item): item is AssistantStoredSession => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_SESSIONS);
}

export function loadStoredSessions() {
  if (typeof window === "undefined") return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
  try {
    const raw = localStorage.getItem(ASSISTANT_SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AssistantStoredSessionsPayload | AssistantStoredSession[];
      const payloadSessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      const sessions = normalizeStoredSessions(payloadSessions);
      const storedActiveId = localStorage.getItem(ASSISTANT_ACTIVE_SESSION_STORAGE_KEY);
      const payloadActiveId = Array.isArray(parsed) ? "" : parsed.activeSessionId;
      const activeSessionId = storedActiveId || payloadActiveId || sessions[0]?.id || "";
      localStorage.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
      return { sessions, activeSessionId };
    }

    // 兼容旧版单会话 key，用户升级后仍能看到之前的聊天记录。
    const legacyRaw = localStorage.getItem(ASSISTANT_SESSION_STORAGE_KEY);
    if (!legacyRaw) return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
    const legacy = JSON.parse(legacyRaw) as Partial<AssistantStoredSession>;
    const messages = normalizeStoredMessages(Array.isArray(legacy.messages) ? legacy.messages : []);
    if (!messages.length) return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
    const updatedAt = Number.isFinite(legacy.updatedAt) ? Number(legacy.updatedAt) : Date.now();
    const migratedSession: AssistantStoredSession = {
      id: createSessionId(),
      title: sessionTitleFromMessages(messages),
      messages,
      createdAt: updatedAt,
      updatedAt,
    };
    return { sessions: [migratedSession], activeSessionId: migratedSession.id };
  } catch {
    return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
  }
}

export function saveStoredSessions(sessions: AssistantStoredSession[], activeSessionId: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeStoredSessions(sessions);
  if (!normalized.length && !activeSessionId) {
    localStorage.removeItem(ASSISTANT_SESSIONS_STORAGE_KEY);
    localStorage.removeItem(ASSISTANT_ACTIVE_SESSION_STORAGE_KEY);
    localStorage.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ASSISTANT_SESSIONS_STORAGE_KEY, JSON.stringify({ sessions: normalized, activeSessionId } satisfies AssistantStoredSessionsPayload));
  if (activeSessionId) {
    localStorage.setItem(ASSISTANT_ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  } else {
    localStorage.removeItem(ASSISTANT_ACTIVE_SESSION_STORAGE_KEY);
  }
  localStorage.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
}
