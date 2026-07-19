import type { AssistantChatMessage, AssistantStoredSession } from "./types";

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / 1024 / 1024).toFixed(1) + " MB";
}

export function formatSessionTime(value: number) {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  const diff = Date.now() - value;
  if (diff >= 0 && diff < 60 * 1000) return "刚刚";
  if (diff >= 0 && diff < 60 * 60 * 1000) return Math.max(1, Math.floor(diff / (60 * 1000))) + " 分钟前";
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.max(1, Math.floor(diff / (60 * 60 * 1000))) + " 小时前";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function sessionPreviewFromMessages(messages: AssistantChatMessage[]) {
  let lastMessage: AssistantChatMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.content.trim()) {
      lastMessage = messages[index];
      break;
    }
  }
  const preview = lastMessage?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!preview) return "暂无内容预览";
  return preview.length > 42 ? preview.slice(0, 42) + "..." : preview;
}

export function sessionUserMessageCount(session: AssistantStoredSession) {
  return session.messages.filter((item) => item.role === "user").length;
}
