import { referenceKindFromMeta } from "@/lib/upload-limits";
import { defaultSkillInputValues } from "@/lib/skill-api";
import type { CanvasLaunchJournal } from "@/lib/canvas-launch";
import type { AiTaskVO } from "@/types/ai";
import type { FileVO } from "@/types/file";
import { skillKindOf, type SkillVO } from "@/types/skill";
import type {
  SkillRunAssetInput,
  SkillRunMessageInput,
  SkillRunVO,
} from "@/types/skill-run";
import type { CanvasReferenceItem } from "../../domain/models/canvas-reference";
import {
  normalizeAssistantChatRequest,
  normalizeAssistantTaskId,
  writeVerifiedAssistantRecoverySnapshot,
  type AssistantChatRequestSnapshot,
} from "./assistant-chat-recovery";
import { canvasSkillRunArtifacts } from "./canvas-skill-runtime";
import { captureCanvasError } from "../../infrastructure/telemetry/canvas-telemetry";

export const ASSISTANT_HANDLER = "assistant_chat";
export const CHAT_POLL_INTERVAL = 1_500;
export const CHAT_FOREGROUND_POLL_TIME = 60_000;
export const MAX_SKILL_PROMPT_BYTES = 32 * 1024;
export const MAX_SKILL_ASSETS = 32;
export const MAX_SKILL_SOURCE_NODES = 64;
export const MAX_RECOVERY_RUNS = 50;

const ASSISTANT_STORAGE_PREFIX = "tc:assistant:v2";
const LEGACY_ASSISTANT_STORAGE_KEYS = [
  "tc:assistant:session",
  "tc:assistant:sessions",
  "tc:assistant:activeSessionId",
] as const;
const MAX_STORED_MESSAGES = 80;
export const MAX_STORED_SESSIONS = 20;
const MAX_SKILL_HISTORY_BYTES = 240 * 1024;

export type AssistantChatRole = "user" | "assistant";
export type AssistantChatStatus = "done" | "pending" | "error";

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  attachments?: FileVO[];
  status: AssistantChatStatus;
  skillRunId?: string;
  skillTitle?: string;
  clientRequestId?: string;
  taskId?: string;
  chatRequest?: AssistantChatRequestSnapshot;
  includeInHistory?: boolean;
}

export interface AssistantStoredSession {
  id: string;
  title: string;
  messages: AssistantChatMessage[];
  selectedSkill: SkillVO | null;
  skillParameters: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface AssistantStoredSessionsPayload {
  sessions: AssistantStoredSession[];
  activeSessionId?: string;
}

export function clampPanelWidth(width: number, minimum = 380, maximum = 720): number {
  return Math.min(maximum, Math.max(minimum, width));
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function trimSkillHistory(messages: SkillRunMessageInput[]): SkillRunMessageInput[] {
  const kept: SkillRunMessageInput[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    const bytes = utf8Length(item.content) + utf8Length(item.role) + 16;
    if (bytes > MAX_SKILL_HISTORY_BYTES) continue;
    if (used + bytes > MAX_SKILL_HISTORY_BYTES) break;
    kept.push(item);
    used += bytes;
  }
  return kept.reverse();
}

export function skillRunHistoryContent(run: SkillRunVO, fallbackTitle?: string): string {
  const title = run.skillTitle || fallbackTitle || "技能";
  const finals = canvasSkillRunArtifacts(run).filter((artifact) => artifact.isFinal !== false);
  const text = finals
    .map((artifact) => artifact.text?.trim() || artifact.content?.trim() || "")
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 24 * 1024);
  const media = finals
    .filter((artifact) => !artifact.text?.trim() && !artifact.content?.trim())
    .map((artifact) => `${artifact.type}${artifact.title ? `「${artifact.title}」` : ""}`)
    .join("、");
  return [`「${title}」已完成。`, text, media ? `画布产物：${media}` : ""]
    .filter(Boolean)
    .join("\n");
}

/** 附件引用编号必须与实际送入模型的图片顺序一致。 */
export function buildMentionRefs(files: FileVO[]): {
  mentionRefs: CanvasReferenceItem[];
  refLabels: Array<string | null>;
} {
  const mentionRefs: CanvasReferenceItem[] = [];
  const refLabels: Array<string | null> = [];
  files.forEach((file) => {
    const url = (file.fileUrl ?? "").trim();
    if (referenceKindFromMeta(file) === "image" && /^(https?:|data:)/.test(url)) {
      const index = mentionRefs.length + 1;
      mentionRefs.push({
        id: `${file.id}-${index}`,
        thumb: url,
        title: file.originalName,
        index,
        kind: "image",
        src: url,
      });
      refLabels.push(`图片${index}`);
    } else {
      refLabels.push(null);
    }
  });
  return { mentionRefs, refLabels };
}

/** 删除附件后，以单趟替换方式重排正文引用，避免链式替换撞号。 */
export function remapRefTokens(
  text: string,
  before: Array<string | null>,
  after: Array<string | null>,
): string {
  const remap = new Map<string, string | null>();
  before.forEach((from, index) => {
    if (!from) return;
    const to = after[index];
    if (to !== from) remap.set(from, to);
  });
  if (remap.size === 0) return text;
  return text.replace(
    /(图片)(\d+)(?!\d)/g,
    (match) => remap.has(match) ? (remap.get(match) ?? "") : match,
  );
}

function attachmentSummary(files?: FileVO[]): string {
  if (!files?.length) return "";
  return files.map((file) => {
    const parts = [file.originalName || "未命名文件"];
    if (file.mimeType) parts.push(`(${file.mimeType})`);
    if (file.fileUrl) parts.push(file.fileUrl);
    return `- ${parts.join(" ")}`;
  }).join("\n");
}

export function messageContentForHistory(item: AssistantChatMessage): string {
  const summary = attachmentSummary(item.attachments);
  return summary ? `${item.content}\n\n附件：\n${summary}` : item.content;
}

function normalizeStoredSkill(value: unknown): SkillVO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const skill = value as Partial<SkillVO>;
  if (
    typeof skill.id !== "string"
    || !skill.id.trim()
    || typeof skill.title !== "string"
    || !skill.title.trim()
  ) return null;
  return { ...skill, kind: skillKindOf(skill) } as SkillVO;
}

function normalizeStoredParameters(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function filesToSkillAssets(files: FileVO[]): SkillRunAssetInput[] {
  return files.map((file) => ({
    id: file.id,
    type: referenceKindFromMeta(file),
    url: file.fileUrl,
    role: "reference",
    name: file.originalName,
    metadata: {
      source: "canvas_assistant",
      fileSize: file.fileSize,
      mimeType: file.mimeType,
    },
  }));
}

function skillAssetKey(asset: SkillRunAssetInput): string {
  if (asset.url?.trim()) return `${asset.type}:url:${asset.url.trim()}`;
  if (asset.content?.trim()) {
    return `${asset.type}:content:${asset.nodeId ?? ""}:${asset.content.trim()}`;
  }
  if (asset.id?.trim()) return `${asset.type}:id:${asset.id.trim()}`;
  if (asset.nodeId?.trim()) return `${asset.type}:node:${asset.nodeId.trim()}`;
  return `${asset.type}:${asset.role ?? ""}:${asset.name ?? ""}`;
}

export function uniqueSkillAssets(
  assets: readonly SkillRunAssetInput[],
): SkillRunAssetInput[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = skillAssetKey(asset);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function canvasLaunchSkillParameters(
  journal: CanvasLaunchJournal,
  skill: SkillVO,
): Record<string, unknown> {
  const defaults = defaultSkillInputValues(skill.inputSchema, skill.defaultParams);
  if (skillKindOf(skill) === "agent") return defaults;
  const ratio = journal.mode === "image" ? journal.imageRatio : journal.videoRatio;
  const resolution = journal.mode === "image"
    ? journal.imageResolution
    : journal.videoResolution;
  return {
    ...defaults,
    ...(journal.modelId ? { modelId: journal.modelId } : {}),
    ...(ratio && ratio !== "auto"
      ? { aspectRatio: ratio, aspect_ratio: ratio, ratio }
      : {}),
    ...(resolution ? { resolution } : {}),
    ...(journal.mode === "image"
      ? { quality: journal.imageQuality, clarity: journal.imageResolution }
      : { duration: journal.videoDuration }),
  };
}

export function normalizeStoredMessages(
  messages: AssistantChatMessage[],
): AssistantChatMessage[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .filter((item) => item.content.trim() || item.attachments?.length)
    .map((item) => {
      const chatRequest = normalizeAssistantChatRequest(item.chatRequest);
      const taskId = normalizeAssistantTaskId(item.taskId);
      const recoverableSkillRun = item.status === "pending" && Boolean(item.skillRunId);
      const recoverableAssistantTask = item.status === "pending" && Boolean(chatRequest);
      const interrupted = item.status === "pending"
        && !recoverableSkillRun
        && !recoverableAssistantTask;
      return {
        ...item,
        taskId,
        ...(chatRequest
          ? { chatRequest, clientRequestId: chatRequest.clientRequestId }
          : { chatRequest: undefined }),
        status: interrupted ? "error" as const : item.status,
        content: interrupted ? "上次回复中断，请重新发送。" : item.content,
      };
    })
    .slice(-MAX_STORED_MESSAGES);
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSessionTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.length > 18 ? `${title.slice(0, 18)}...` : title;
}

export function sessionTitleFromMessages(messages: AssistantChatMessage[]): string {
  const firstUserMessage = messages.find(
    (item) => item.role === "user" && (item.content.trim() || item.attachments?.length),
  );
  const contentTitle = normalizeSessionTitle(firstUserMessage?.content ?? "");
  if (contentTitle) return contentTitle;
  const attachmentName = firstUserMessage?.attachments?.[0]?.originalName;
  return attachmentName ? normalizeSessionTitle(`附件 ${attachmentName}`) : "未命名会话";
}

export function normalizeStoredSessions(value: unknown): AssistantStoredSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const session = item as Partial<AssistantStoredSession>;
      const messages = normalizeStoredMessages(
        Array.isArray(session.messages) ? session.messages : [],
      );
      if (messages.length === 0) return null;
      const updatedAt = Number.isFinite(session.updatedAt) ? Number(session.updatedAt) : Date.now();
      const createdAt = Number.isFinite(session.createdAt) ? Number(session.createdAt) : updatedAt;
      return {
        id: typeof session.id === "string" && session.id.trim()
          ? session.id
          : createSessionId(),
        title: normalizeSessionTitle(typeof session.title === "string" ? session.title : "")
          || sessionTitleFromMessages(messages),
        messages,
        selectedSkill: normalizeStoredSkill(session.selectedSkill),
        skillParameters: normalizeStoredParameters(session.skillParameters),
        createdAt,
        updatedAt,
      } satisfies AssistantStoredSession;
    })
    .filter((item): item is AssistantStoredSession => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_STORED_SESSIONS);
}

export function assistantStorageKeys(scope: string): {
  sessions: string;
  activeSession: string;
  model: string;
} {
  const prefix = `${ASSISTANT_STORAGE_PREFIX}:${scope}`;
  return {
    sessions: `${prefix}:sessions`,
    activeSession: `${prefix}:activeSessionId`,
    model: `${prefix}:modelId`,
  };
}

export function loadStoredSessions(scope: string): {
  sessions: AssistantStoredSession[];
  activeSessionId: string;
} {
  if (typeof window === "undefined") return { sessions: [], activeSessionId: "" };
  try {
    const keys = assistantStorageKeys(scope);
    LEGACY_ASSISTANT_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    const raw = localStorage.getItem(keys.sessions);
    if (!raw) return { sessions: [], activeSessionId: "" };
    const parsed = JSON.parse(raw) as AssistantStoredSessionsPayload | AssistantStoredSession[];
    const payloadSessions = Array.isArray(parsed) ? parsed : parsed.sessions;
    const sessions = normalizeStoredSessions(payloadSessions);
    const storedActiveId = localStorage.getItem(keys.activeSession);
    const payloadActiveId = Array.isArray(parsed) ? "" : parsed.activeSessionId;
    return {
      sessions,
      activeSessionId: storedActiveId || payloadActiveId || sessions[0]?.id || "",
    };
  } catch (error) {
    captureCanvasError("canvas.assistant.storage_read_failed", error, { scope });
    return { sessions: [], activeSessionId: "" };
  }
}

export function saveStoredSessions(
  sessions: AssistantStoredSession[],
  activeSessionId: string,
  scope: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const keys = assistantStorageKeys(scope);
    const normalized = normalizeStoredSessions(sessions);
    if (normalized.length === 0 && !activeSessionId) {
      localStorage.removeItem(keys.sessions);
      localStorage.removeItem(keys.activeSession);
      return;
    }
    localStorage.setItem(
      keys.sessions,
      JSON.stringify({ sessions: normalized, activeSessionId } satisfies AssistantStoredSessionsPayload),
    );
    if (activeSessionId) localStorage.setItem(keys.activeSession, activeSessionId);
    else localStorage.removeItem(keys.activeSession);
  } catch (error) {
    captureCanvasError("canvas.assistant.storage_write_failed", error, { scope });
  }
}

/** 在付费创建请求前，先验证冻结请求已完整写入当前作用域恢复快照。 */
export function persistAssistantChatBeforeCreate(
  sessions: AssistantStoredSession[],
  activeSessionId: string,
  scope: string,
  assistantId: string,
  request: AssistantChatRequestSnapshot,
): boolean {
  if (typeof window === "undefined" || !scope || !activeSessionId) return false;
  try {
    const normalized = normalizeStoredSessions(sessions);
    const pendingMessage = normalized
      .find((session) => session.id === activeSessionId)
      ?.messages.find((item) => item.id === assistantId);
    if (
      pendingMessage?.status !== "pending"
      || pendingMessage.chatRequest?.clientRequestId !== request.clientRequestId
      || pendingMessage.chatRequest.userMessageId !== request.userMessageId
      || JSON.stringify(pendingMessage.chatRequest) !== JSON.stringify(request)
    ) return false;

    const keys = assistantStorageKeys(scope);
    const serialized = JSON.stringify({
      sessions: normalized,
      activeSessionId,
    } satisfies AssistantStoredSessionsPayload);
    if (!writeVerifiedAssistantRecoverySnapshot(localStorage, keys.sessions, serialized)) return false;

    const persistedRaw = localStorage.getItem(keys.sessions);
    if (!persistedRaw) return false;
    const persisted = JSON.parse(persistedRaw) as AssistantStoredSessionsPayload;
    const persistedMessage = normalizeStoredSessions(persisted.sessions)
      .find((session) => session.id === activeSessionId)
      ?.messages.find((item) => item.id === assistantId);
    if (
      persistedMessage?.status !== "pending"
      || persistedMessage.chatRequest?.clientRequestId !== request.clientRequestId
      || persistedMessage.chatRequest.userMessageId !== request.userMessageId
      || JSON.stringify(persistedMessage.chatRequest) !== JSON.stringify(request)
    ) return false;

    try {
      localStorage.setItem(keys.activeSession, activeSessionId);
    } catch {
      // 已验证的 sessions 快照足以恢复，活动指针仅是便利索引。
    }
    return true;
  } catch (error) {
    captureCanvasError("canvas.assistant.recovery_snapshot_failed", error, { scope });
    return false;
  }
}

export function parseTaskResult(task: AiTaskVO): string {
  const rawMeta = task.resultMeta;
  const meta = typeof rawMeta === "string"
    ? (() => {
        try {
          return JSON.parse(rawMeta) as Record<string, unknown>;
        } catch {
          return { text: rawMeta };
        }
      })()
    : rawMeta;

  if (meta && typeof meta === "object") {
    for (const key of [
      "answer",
      "content",
      "text",
      "message",
      "response",
      "output",
      "enhancedPrompt",
    ]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof task.resultUrl === "string" && task.resultUrl.trim()) return task.resultUrl.trim();
  return "已完成，但接口没有返回可展示的文本。";
}
