"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronDown, ChevronRight, Expand, FileText, Loader2, Maximize2, Menu, Minimize2, Plus, Sparkles, Wand2, X, Zap } from "lucide-react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { referenceKindFromFile, referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { PromptRefEditor } from "./nodes/prompt-ref-editor";
import { ModelPicker } from "./nodes/model-picker";
import type { RefItem } from "./nodes/prompt-ref-utils";
import { toast } from "@/components/shared/toast";
import { SkillPicker } from "@/components/skill/skill-picker";
import { SkillPromptChip } from "@/components/skill/skill-prompt-chip";
import { SkillInputFields } from "@/components/skill/skill-input-fields";
import { SkillRunPanel } from "@/components/skill/skill-run-panel";
import { defaultSkillInputValues, validateSkillRunInputValues } from "@/lib/skill-api";
import { promptAfterSkillPick } from "@/lib/skill-prompt";
import { clearCanvasLaunchJournal, type CanvasLaunchJournal } from "@/lib/canvas-launch";
import { requestCanvasSave } from "@/lib/canvas-save";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import type { FileVO } from "@/types/file";
import { SKILL_KIND_LABEL, skillKindOf, type SkillVO } from "@/types/skill";
import { isSkillRunActive, type SkillRunArtifactVO, type SkillRunAssetInput, type SkillRunMessageInput, type SkillRunVO } from "@/types/skill-run";
import { buildCanvasSkillRunInput } from "./skill-run/canvas-skill-input";
import { buildSkillArtifactNodes } from "./skill-run/materialize-artifacts";
import { useSkillRuns } from "./skill-run/use-skill-runs";
import {
  canvasSkillRunArtifacts,
  canvasSkillRunSourceNodeIds,
  createCanvasSkillClientRequestId,
  pendingCanvasCreateRunIds,
  persistCanvasRunAndCommit,
} from "./skill-run/canvas-skill-runtime";
import {
  assistantChatRetryDelay,
  createAssistantChatClientRequestId,
  isAmbiguousAssistantCreateCode,
  isTerminalAssistantLookupCode,
  normalizeAssistantChatRequest,
  normalizeAssistantTaskId,
  writeVerifiedAssistantRecoverySnapshot,
  type AssistantChatRequestSnapshot,
} from "./canvas-assistant-chat-recovery";

const SUGGESTIONS = ["梳理创作思路", "生成图片或视频", "编排跨媒体内容"];


const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 460;
const ASSISTANT_STORAGE_PREFIX = "tc:assistant:v2";
const LEGACY_ASSISTANT_STORAGE_KEYS = [
  "tc:assistant:session",
  "tc:assistant:sessions",
  "tc:assistant:activeSessionId",
] as const;
const ASSISTANT_HANDLER = "assistant_chat";
const CHAT_POLL_INTERVAL = 1500;
const CHAT_FOREGROUND_POLL_TIME = 60 * 1000;
const MAX_STORED_MESSAGES = 80;
const MAX_STORED_SESSIONS = 20;
const MAX_SKILL_HISTORY_BYTES = 240 * 1024;
const MAX_SKILL_PROMPT_BYTES = 32 * 1024;
const MAX_SKILL_ASSETS = 32;
const MAX_SKILL_SOURCE_NODES = 64;
const MAX_RECOVERY_RUNS = 50;
const MAX_ASSISTANT_ATTACHMENTS = 12;

export const CANVAS_ASSISTANT_VISIBILITY_EVENT = "tidecanvas:canvas-assistant-visibility";

type AssistantChatRole = "user" | "assistant";
type AssistantChatStatus = "done" | "pending" | "error";

interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  attachments?: FileVO[];
  status: AssistantChatStatus;
  skillRunId?: string;
  skillTitle?: string;
  /** Stable create id used to rebind an ambiguous network response after recovery. */
  clientRequestId?: string;
  /** Ordinary assistant task id; retained until a backend terminal state is observed. */
  taskId?: string;
  /** Frozen create payload. Retries must replay this byte-for-byte equivalent request. */
  chatRequest?: AssistantChatRequestSnapshot;
  includeInHistory?: boolean;
}

interface AssistantStoredSession {
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

interface CanvasAssistantPanelProps {
  launchJournal?: CanvasLaunchJournal | null;
  persistenceReady?: boolean;
  onLaunchConsumed?: () => void;
}

interface PendingCanvasHandoff {
  id: string;
  clientRequestId: string;
  skillId: string;
  runId?: string;
}

interface PendingSkillRetry {
  fingerprint: string;
  clientRequestId: string;
}

interface AssistantChatRecoveryJob {
  scope: string;
  sessionId: string;
  assistantId: string;
  request: AssistantChatRequestSnapshot;
  taskId?: string;
}

type AssistantChatRecoveryOutcome = "active" | "completed" | "rejected";

function assistantChatRecoveryKey(job: AssistantChatRecoveryJob) {
  return `${job.scope}:${job.sessionId}:${job.assistantId}`;
}

function clampPanelWidth(width: number) {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

function assistantAttachmentError(model: AiModelVO | undefined, count: number): string | null {
  if (count <= 0) return null;
  if (count > MAX_ASSISTANT_ATTACHMENTS) {
    return `一次最多分析 ${MAX_ASSISTANT_ATTACHMENTS} 个附件，请减少后重试`;
  }
  if (!model?.config) return null;
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(model.config);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    config = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const fileUpload = config.fileUpload;
  const schema = config.paramsSchema;
  const schemaFileUpload = schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as Record<string, unknown>).file_upload
    : undefined;
  if (fileUpload === false || schemaFileUpload === false) {
    return "当前文本模型不支持图片或文件输入，请切换支持视觉理解的文本模型";
  }
  const rawMax = Number(config.maxFileCount);
  const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 0;
  if (max > 0 && count > max) {
    return `当前文本模型最多分析 ${max} 个附件，当前选择了 ${count} 个，请减少后重试`;
  }
  return null;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / 1024 / 1024).toFixed(1) + " MB";
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function trimSkillHistory(messages: SkillRunMessageInput[]): SkillRunMessageInput[] {
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

function skillRunHistoryContent(run: SkillRunVO, fallbackTitle?: string): string {
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
  return [`「${title}」已完成。`, text, media ? `画布产物：${media}` : ""].filter(Boolean).join("\n");
}

/** 附件 → 可 @ 引用的「图片N」列表 + 与 files 等长的标签数组（不可引用处为 null）。
 *
 *  只有**图片**可引用：服务端 assistant_chat 把图片作为 image_url part 下发，
 *  视频/音频/文档不进模型（转成一句文字说明或 file part），给它们编号等于让用户
 *  引用一个模型看不见的东西。
 *  过滤条件与服务端 chatattach.ImageURLs 逐条对齐（只收绝对 URL / data:）——
 *  否则前端编到「图片2」的那张在模型那边可能是第 1 张，错位比不给更糟。
 *  编号规则只此一份：memo 与 removeAttachment 的重映射共用，避免两处漂移。 */
function buildMentionRefs(files: FileVO[]): { mentionRefs: RefItem[]; refLabels: (string | null)[] } {
  const mentionRefs: RefItem[] = [];
  const refLabels: (string | null)[] = [];
  for (const file of files) {
    const url = (file.fileUrl ?? "").trim();
    if (referenceKindFromMeta(file) === "image" && /^(https?:|data:)/.test(url)) {
      const index = mentionRefs.length + 1;
      mentionRefs.push({ id: `${file.id}-${index}`, thumb: url, title: file.originalName, index, kind: "image", src: url });
      refLabels.push(`图片${index}`);
    } else {
      refLabels.push(null);
    }
  }
  return { mentionRefs, refLabels };
}

/** 附件删除后重写正文里已写下的 token。
 *
 *  「图片N」是位置编号，删掉一张会让其后编号整体前移，两类 token 都要处理：
 *   · **幸存者**：旧 label → 新 label（「图片3」→「图片2」）；
 *   · **被删那张自己的 token**：after 为 null，必须**删掉**而不是留着。
 *     留着的话它会与重编号后的幸存者撞号——[A,B] 里删掉 A，正文
 *     「对比图片1和图片2」会变成「对比图片1和图片1」，两个 pill 都绑到 B，
 *     模型被要求「拿同一张图和自己对比」，还照扣积分。
 *  所以 map 必须区分「没这个 key」和「映射到 null」：前者保留，后者删除。
 *
 *  一次性替换（单趟 replace），避免「图片1→图片2、图片2→图片3」链式误替。 */
function remapRefTokens(text: string, before: (string | null)[], after: (string | null)[]): string {
  const remap = new Map<string, string | null>();
  for (let i = 0; i < before.length; i += 1) {
    const from = before[i];
    if (!from) continue; // 非图片槽位不参与，永不作为 key
    const to = after[i];
    if (to !== from) remap.set(from, to); // to === null ⇒ 该 token 整个删掉
  }
  if (!remap.size) return text;
  return text.replace(/(图片)(\d+)(?!\d)/g, (m) => (remap.has(m) ? (remap.get(m) ?? "") : m));
}

function attachmentSummary(files?: FileVO[]) {
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

function messageContentForHistory(item: AssistantChatMessage) {
  const summary = attachmentSummary(item.attachments);
  return summary ? item.content + "\n\n附件：\n" + summary : item.content;
}

function normalizeStoredSkill(value: unknown): SkillVO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const skill = value as Partial<SkillVO>;
  if (typeof skill.id !== "string" || !skill.id.trim() || typeof skill.title !== "string" || !skill.title.trim()) return null;
  return { ...skill, kind: skillKindOf(skill) } as SkillVO;
}

function normalizeStoredParameters(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function filesToSkillAssets(files: FileVO[]) {
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
  if (asset.content?.trim()) return `${asset.type}:content:${asset.nodeId ?? ""}:${asset.content.trim()}`;
  if (asset.id?.trim()) return `${asset.type}:id:${asset.id.trim()}`;
  if (asset.nodeId?.trim()) return `${asset.type}:node:${asset.nodeId.trim()}`;
  return `${asset.type}:${asset.role ?? ""}:${asset.name ?? ""}`;
}

function uniqueSkillAssets(assets: readonly SkillRunAssetInput[]): SkillRunAssetInput[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = skillAssetKey(asset);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canvasLaunchSkillParameters(journal: CanvasLaunchJournal, skill: SkillVO): Record<string, unknown> {
  const defaults = defaultSkillInputValues(skill.inputSchema, skill.defaultParams);
  // Agent Skills own their cross-media planning. Hidden single-model controls
  // from the project launcher must not override the Agent's published defaults.
  if (skillKindOf(skill) === "agent") return defaults;
  const ratio = journal.mode === "image" ? journal.imageRatio : journal.videoRatio;
  const resolution = journal.mode === "image" ? journal.imageResolution : journal.videoResolution;
  return {
    ...defaults,
    ...(journal.modelId ? { modelId: journal.modelId } : {}),
    ...(ratio && ratio !== "auto" ? { aspectRatio: ratio, aspect_ratio: ratio, ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(journal.mode === "image"
      ? { quality: journal.imageQuality, clarity: journal.imageResolution }
      : { duration: journal.videoDuration }),
  };
}

function normalizeStoredMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .filter((item) => item.content.trim() || item.attachments?.length)
    .map((item) => {
      const chatRequest = normalizeAssistantChatRequest(item.chatRequest);
      const taskId = normalizeAssistantTaskId(item.taskId);
      const recoverableSkillRun = item.status === "pending" && !!item.skillRunId;
      const recoverableAssistantTask = item.status === "pending" && !!chatRequest;
      return {
        ...item,
        taskId,
        ...(chatRequest ? { chatRequest, clientRequestId: chatRequest.clientRequestId } : { chatRequest: undefined }),
        status: item.status === "pending" && !recoverableSkillRun && !recoverableAssistantTask ? "error" as const : item.status,
        content: item.status === "pending" && !recoverableSkillRun && !recoverableAssistantTask ? "上次回复中断，请重新发送。" : item.content,
      };
    })
    .slice(-MAX_STORED_MESSAGES);
}

function createSessionId() {
  return "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeSessionTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.length > 18 ? title.slice(0, 18) + "..." : title;
}

function sessionTitleFromMessages(messages: AssistantChatMessage[]) {
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
        selectedSkill: normalizeStoredSkill(session.selectedSkill),
        skillParameters: normalizeStoredParameters(session.skillParameters),
        createdAt,
        updatedAt,
      } satisfies AssistantStoredSession;
    })
    .filter((item): item is AssistantStoredSession => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_SESSIONS);
}

function assistantStorageKeys(scope: string) {
  const prefix = `${ASSISTANT_STORAGE_PREFIX}:${scope}`;
  return {
    sessions: `${prefix}:sessions`,
    activeSession: `${prefix}:activeSessionId`,
    model: `${prefix}:modelId`,
  };
}

function loadStoredSessions(scope: string) {
  if (typeof window === "undefined") return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
  try {
    const keys = assistantStorageKeys(scope);
    for (const key of LEGACY_ASSISTANT_STORAGE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(keys.sessions);
    if (raw) {
      const parsed = JSON.parse(raw) as AssistantStoredSessionsPayload | AssistantStoredSession[];
      const payloadSessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      const sessions = normalizeStoredSessions(payloadSessions);
      const storedActiveId = localStorage.getItem(keys.activeSession);
      const payloadActiveId = Array.isArray(parsed) ? "" : parsed.activeSessionId;
      const activeSessionId = storedActiveId || payloadActiveId || sessions[0]?.id || "";
      return { sessions, activeSessionId };
    }
    // The old keys were global across accounts/projects. Never migrate their
    // contents into an authenticated scope because that could expose another
    // user's prompts or attachment URLs on a shared browser.
    return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
  } catch {
    return { sessions: [] as AssistantStoredSession[], activeSessionId: "" };
  }
}

function saveStoredSessions(sessions: AssistantStoredSession[], activeSessionId: string, scope: string) {
  if (typeof window === "undefined") return;
  const keys = assistantStorageKeys(scope);
  const normalized = normalizeStoredSessions(sessions);
  if (!normalized.length && !activeSessionId) {
    localStorage.removeItem(keys.sessions);
    localStorage.removeItem(keys.activeSession);
    return;
  }
  localStorage.setItem(keys.sessions, JSON.stringify({ sessions: normalized, activeSessionId } satisfies AssistantStoredSessionsPayload));
  if (activeSessionId) {
    localStorage.setItem(keys.activeSession, activeSessionId);
  } else {
    localStorage.removeItem(keys.activeSession);
  }
}

/**
 * The first paid POST must never outrun React's persistence effect. Commit the
 * frozen request in the scoped session key and read it back before creating the
 * task. The active-session key is only a convenience pointer; the sessions
 * payload is the durable source of truth and is written atomically first.
 */
function persistAssistantChatBeforeCreate(
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

    // Confirm the exact frozen request is readable before the paid request.
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

    // A stale pointer cannot hide recovery because every stored session is
    // scanned, so pointer persistence is intentionally best effort.
    try {
      localStorage.setItem(keys.activeSession, activeSessionId);
    } catch {
      /* the verified sessions payload remains sufficient for recovery */
    }
    return true;
  } catch {
    return false;
  }
}

function parseTaskResult(task: AiTaskVO) {
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
    for (const key of ["answer", "content", "text", "message", "response", "output", "enhancedPrompt"]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  if (typeof task.resultUrl === "string" && task.resultUrl.trim()) return task.resultUrl.trim();
  return "已完成，但接口没有返回可展示的文本。";
}

export function CanvasAssistantPanel({
  launchJournal,
  persistenceReady = false,
  onLaunchConsumed,
}: CanvasAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [sessions, setSessions] = useState<AssistantStoredSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [attachments, setAttachments] = useState<FileVO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillVO | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillParameters, setSkillParameters] = useState<Record<string, unknown>>({});
  const [skillParameterErrors, setSkillParameterErrors] = useState<Record<string, string>>({});
  const [readySessionScope, setReadySessionScope] = useState("");
  const [resizing, setResizing] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assistantPanelRef = useRef<HTMLElement>(null);
  const assistantLauncherRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSeqRef = useRef(0);
  const sessionLoadedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const sendLockRef = useRef(false);
  const handoffHandledRef = useRef("");
  const pendingHandoffRef = useRef<PendingCanvasHandoff | null>(null);
  const pendingSkillRetryRef = useRef<PendingSkillRetry | null>(null);
  const assistantChatTimersRef = useRef(new Map<string, number>());
  const assistantChatInFlightRef = useRef(new Set<string>());
  const assistantChatFailuresRef = useRef(new Map<string, number>());
  const assistantChatReconnectNoticesRef = useRef(new Set<string>());
  const assistantChatDeadlineNoticesRef = useRef(new Set<string>());
  const runAssistantChatRecoveryRef = useRef<(job: AssistantChatRecoveryJob) => Promise<AssistantChatRecoveryOutcome>>(
    async () => "active",
  );
  const sessionScopeRef = useRef("");
  const sessionLoadGenerationRef = useRef(0);
  const projectId = useCanvasStore((state) => state.currentProjectId);
  const ownerId = useAuthStore((state) => state.user?.id ?? "");
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const trackedSkillRunIds = useCanvasStore((state) => state.trackedSkillRunIds);
  const materializedArtifactIds = useCanvasStore((state) => state.materializedArtifactIds);
  const assistantScope = ownerId && projectId ? `${ownerId}:${projectId}` : "";
  const assistantRecoveryScopeRef = useRef(assistantScope);
  const assistantTargetType = useMemo(() => {
    const types = [...new Set(canvasNodes.filter((node) => selectedNodeIds.has(node.id)).map((node) => node.type))];
    return types.length === 1 ? types[0] : undefined;
  }, [canvasNodes, selectedNodeIds]);
  const recoveryRunIds = useMemo(() => {
    const idsByPriority = [
      ...trackedSkillRunIds,
      ...(projectId ? pendingCanvasCreateRunIds(projectId) : []),
      ...messages.flatMap((item) => item.skillRunId ? [item.skillRunId] : []),
    ];
    // Keep the last occurrence so pending/current-session runs win when the cap is reached.
    return [...new Set(idsByPriority.reverse())].reverse().slice(-MAX_RECOVERY_RUNS);
  }, [messages, projectId, trackedSkillRunIds]);
  const { runs, loading: runsLoading, actionBusy, createRun, performAction } = useSkillRuns(projectId, recoveryRunIds);

  useLayoutEffect(() => {
    if (assistantRecoveryScopeRef.current === assistantScope) return;
    assistantRecoveryScopeRef.current = assistantScope;
    assistantChatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    assistantChatTimersRef.current.clear();
    assistantChatInFlightRef.current.clear();
    assistantChatFailuresRef.current.clear();
    assistantChatReconnectNoticesRef.current.clear();
    assistantChatDeadlineNoticesRef.current.clear();
  }, [assistantScope]);

  // 画布创作栏要按助手实际占位右缩：开关、拖宽、展开都改变占位，随既有
  // 可见性事件把当前占位宽度（面板宽 + 右缘 16px 偏移 + 16px 间隔）一并广播。
  useEffect(() => {
    const broadcast = () => {
      const panelPx = Math.min(expanded ? MAX_PANEL_WIDTH : panelWidth, window.innerWidth - 32);
      window.dispatchEvent(new CustomEvent(CANVAS_ASSISTANT_VISIBILITY_EVENT, {
        detail: { open, width: open ? panelPx + 32 : 0 },
      }));
    };
    broadcast();
    if (!open) return;
    window.addEventListener("resize", broadcast);
    return () => window.removeEventListener("resize", broadcast);
  }, [open, panelWidth, expanded]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (open) {
        assistantPanelRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
      } else {
        assistantLauncherRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // ── @ 引用 ────────────────────────────────────────────────────────────────
  // 只有**图片**附件可引用：服务端 assistant_chat 把图片作为 image_url part 下发，
  // 而视频/音频/文档不进模型（分别转成一句文字说明或 file part），给它们编号等于
  // 让用户引用一个模型看不见的东西。
  // 过滤条件必须与服务端 chatattach.ImageURLs 逐条对齐（只收绝对 URL / data:），
  // 否则前端编到「图片2」的那张，在模型那边可能是第 1 张——编号错位比不给更糟。
  const { mentionRefs, refLabels } = useMemo(() => buildMentionRefs(attachments), [attachments]);
  const runsById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const runsByRequestId = useMemo(
    () => new Map(runs.flatMap((run) => run.clientRequestId ? [[run.clientRequestId, run] as const] : [])),
    [runs],
  );
  const consumeCanvasHandoff = useCallback((handoffId: string) => {
    clearCanvasLaunchJournal(handoffId);
    if (pendingHandoffRef.current?.id === handoffId) pendingHandoffRef.current = null;
    onLaunchConsumed?.();
  }, [onLaunchConsumed]);

  useEffect(() => {
    if (!projectId || useCanvasStore.getState().currentProjectId !== projectId) return;
    const unresolvedCreates = new Set(pendingCanvasCreateRunIds(projectId));
    let canvasChanged = false;
    let persistenceStarted = false;
    for (const run of runs) {
      if (run.entryPoint !== "canvas" || String(run.projectId ?? "") !== projectId) continue;
      const pendingHandoff = pendingHandoffRef.current;
      if (
        pendingHandoff &&
        !pendingHandoff.runId &&
        run.clientRequestId === pendingHandoff.clientRequestId
      ) {
        pendingHandoffRef.current = { ...pendingHandoff, runId: run.id };
      }
      const state = useCanvasStore.getState();
      if (state.currentProjectId !== projectId) return;
      if (!state.trackedSkillRunIds.includes(run.id)) canvasChanged = true;
      state.trackSkillRun(run.id);
      if (!isSkillRunActive(run.status)) {
        if (state.nodes.some((node) => node.skillRunId === run.id)) canvasChanged = true;
        state.settleSkillRun(run.id);
      }

      if (run.status === "succeeded") {
        const consumed = new Set(useCanvasStore.getState().materializedArtifactIds);
        const finalArtifacts = canvasSkillRunArtifacts(run).filter((artifact) => artifact.isFinal !== false && !consumed.has(artifact.id));
        if (finalArtifacts.length > 0) {
          const latest = useCanvasStore.getState();
          const materialized = buildSkillArtifactNodes({
            run,
            artifacts: finalArtifacts,
            nodes: latest.nodes,
            sourceNodeIds: canvasSkillRunSourceNodeIds(run),
          });
          if (materialized.nodes.length > 0) {
            canvasChanged = true;
            latest.addNodesAndConnections(
              materialized.nodes,
              materialized.connections,
              materialized.nodes[materialized.nodes.length - 1].id,
            );
            latest.markSkillArtifactsMaterialized(
              materialized.nodes.flatMap((node) => node.provenance?.artifactId ? [node.provenance.artifactId] : []),
            );
          }
        }
      }
      if (unresolvedCreates.has(run.id)) {
        persistenceStarted = true;
        void persistCanvasRunAndCommit(projectId, run.id).then((committed) => {
          const pending = pendingHandoffRef.current;
          if (committed && pending?.runId === run.id) consumeCanvasHandoff(pending.id);
        });
      }
    }
    if (canvasChanged && !persistenceStarted) void requestCanvasSave(projectId);
  }, [consumeCanvasHandoff, projectId, runs]);

  useEffect(() => {
    if (!assistantScope || (sessionScopeRef.current === assistantScope && readySessionScope === assistantScope)) return;
    const generation = ++sessionLoadGenerationRef.current;
    sessionLoadedRef.current = false;
    pendingHandoffRef.current = null;
    pendingSkillRetryRef.current = null;
    handoffHandledRef.current = "";
    const frame = requestAnimationFrame(() => {
      if (generation !== sessionLoadGenerationRef.current) return;
      const restored = loadStoredSessions(assistantScope);
      setSessions(restored.sessions);
      setActiveSessionId(restored.activeSessionId);
      const activeSession = restored.sessions.find((session) => session.id === restored.activeSessionId);
      if (activeSession) {
        setMessages(activeSession.messages);
        setSelectedSkill(activeSession.selectedSkill ?? null);
        setSkillParameters(activeSession.skillParameters);
        messageSeqRef.current = activeSession.messages.length;
      } else {
        setMessages([]);
        setSelectedSkill(null);
        setSkillParameters({});
        setActiveSessionId("");
      }
      setMessage("");
      setAttachments([]);
      setSkillParameterErrors({});
      sessionScopeRef.current = assistantScope;
      sessionLoadedRef.current = true;
      setReadySessionScope(assistantScope);
    });
    return () => cancelAnimationFrame(frame);
  }, [assistantScope, readySessionScope]);

  useEffect(() => {
    if (assistantScope || (!sessionScopeRef.current && !readySessionScope)) return;
    const generation = ++sessionLoadGenerationRef.current;
    sessionLoadedRef.current = false;
    const frame = requestAnimationFrame(() => {
      if (generation !== sessionLoadGenerationRef.current) return;
      setSessions([]);
      setMessages([]);
      setActiveSessionId("");
      setSelectedSkill(null);
      setSkillParameters({});
      setMessage("");
      setAttachments([]);
      sessionScopeRef.current = "";
      setReadySessionScope("");
    });
    return () => cancelAnimationFrame(frame);
  }, [assistantScope, readySessionScope]);

  useEffect(() => {
    if (!sessionLoadedRef.current || !assistantScope || sessionScopeRef.current !== assistantScope) return;
    const normalized = normalizeStoredMessages(messages);
    // 会话 id 的生成与 setActiveSessionId 必须在 updater 之外:React 更新函数要求纯,
    // StrictMode 双调用时 createSessionId() 会生成两个不同 id、setState 属副作用。
    const nextActiveSessionId = normalized.length ? activeSessionId || createSessionId() : activeSessionId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 兜底:仅遗留无 id 会话首次触发一次
    if (normalized.length && !activeSessionId) setActiveSessionId(nextActiveSessionId);
    setSessions((current) => {
      let next = current;
      if (normalized.length) {
        const existing = current.find((session) => session.id === nextActiveSessionId);
        const now = Date.now();
        const savedSession: AssistantStoredSession = {
          id: nextActiveSessionId,
          title: sessionTitleFromMessages(normalized),
          messages: normalized,
          selectedSkill,
          skillParameters,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        next = [savedSession, ...current.filter((session) => session.id !== nextActiveSessionId)]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_STORED_SESSIONS);
      }
      // localStorage 可能满(20 会话×80 消息含附件 URL)或不可用;写盘失败只记为持久化
      // 失效,绝不在状态更新阶段抛出 QuotaExceededError 把整棵组件树打崩。
      try {
        saveStoredSessions(next, nextActiveSessionId, assistantScope);
      } catch {
        /* 持久化失败:保留内存会话,忽略 */
      }
      return next;
    });
  }, [messages, activeSessionId, assistantScope, selectedSkill, skillParameters]);

  // Background recovery may settle a non-active session. Persist those updates
  // too; the active-session effect above only observes `messages`.
  useEffect(() => {
    if (!sessionLoadedRef.current || !assistantScope || sessionScopeRef.current !== assistantScope) return;
    try {
      saveStoredSessions(sessions, activeSessionId, assistantScope);
    } catch {
      /* localStorage unavailable/full: keep the in-memory recovery state */
    }
  }, [sessions, activeSessionId, assistantScope]);

  useEffect(() => {
    if (open) return;
    const frame = requestAnimationFrame(() => {
      setHistoryOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  useEffect(() => {
    if (!assistantScope) return;
    let cancelled = false;
    aiApi
      .listModels()
      .then((res) => {
        if (cancelled || !res.success) return;
        const enabled = res.data ?? [];
        const textModels = enabled.filter((model) => model.type === AiModelType.TEXT);
        const usable = textModels.length ? textModels : enabled;
        setModels(usable);

        const saved = typeof window !== "undefined" ? localStorage.getItem(assistantStorageKeys(assistantScope).model) : null;
        setSelectedModelId((current) => {
          const currentStillValid = current && usable.some((model) => model.modelId === current);
          if (currentStillValid) return current;
          const savedModel = saved ? usable.find((model) => model.modelId === saved) : undefined;
          return savedModel?.modelId ?? usable[0]?.modelId ?? "";
        });
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assistantScope]);

  useEffect(() => {
    if (!historyOpen) return;

    const handleOutsideClick = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyMenuRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsideClick, true);
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick, true);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [historyOpen]);

  // 拖宽会话的清理函数存进 ref,组件卸载时兜底执行——拖拽中途离开画布的话,
  // window 监听与 body 的 ew-resize 光标/userSelect 会永久残留。
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { resizeCleanupRef.current?.(); }, []);

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    setExpanded(false);
    const startX = event.clientX;
    const panelElement = event.currentTarget.parentElement;
    const startWidth = panelElement?.getBoundingClientRect().width ?? panelWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - moveEvent.clientX;
      setPanelWidth(clampPanelWidth(startWidth + delta));
    };

    const handleUp = () => {
      resizingRef.current = false;
      setResizing(false);
      setResizeHover(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = handleUp;

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [panelWidth]);

  const displayWidth = expanded ? "min(720px, calc(100vw - 32px))" : "min(" + panelWidth + "px, calc(100vw - 32px))";
  const selectedModel = models.find((model) => model.modelId === selectedModelId) ?? models[0];
  const selectedPointCost = Number(selectedModel?.pointCost ?? 0);
  const pointLabel = selectedSkill ? "按技能计费" : selectedPointCost > 0 ? selectedPointCost.toLocaleString() : "免费";
  const selectedSkillKind = selectedSkill ? skillKindOf(selectedSkill) : null;

  const selectModel = (model: AiModelVO) => {
    setSelectedModelId(model.modelId);
    if (typeof window !== "undefined" && assistantScope) {
      localStorage.setItem(assistantStorageKeys(assistantScope).model, model.modelId);
    }
  };

  const pickSkill = (skill: SkillVO) => {
    const pending = pendingHandoffRef.current;
    if (pending && pending.skillId !== skill.id) consumeCanvasHandoff(pending.id);
    setMessage((current) => promptAfterSkillPick(current, skill, selectedSkill));
    setSelectedSkill(skill);
    setSkillParameters(defaultSkillInputValues(skill.inputSchema, skill.defaultParams));
    setSkillParameterErrors({});
    setSkillPickerOpen(false);
    setOpen(true);
  };

  const clearSkill = () => {
    const pending = pendingHandoffRef.current;
    if (pending) consumeCanvasHandoff(pending.id);
    setSelectedSkill(null);
    setSkillParameters({});
    setSkillParameterErrors({});
  };

  const selectSession = (session: AssistantStoredSession) => {
    if (sendLockRef.current) return;
    pendingSkillRetryRef.current = null;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setMessage("");
    setAttachments([]);
    setSelectedSkill(session.selectedSkill ?? null);
    setSkillParameters(session.skillParameters);
    setSkillParameterErrors({});
    messageSeqRef.current = Math.max(messageSeqRef.current, session.messages.length);
    if (assistantScope) saveStoredSessions(sessions, session.id, assistantScope);
    setHistoryOpen(false);
  };

  const startNewSession = () => {
    if (sendLockRef.current) return;
    pendingSkillRetryRef.current = null;
    const sessionId = createSessionId();
    setActiveSessionId(sessionId);
    setMessage("");
    setAttachments([]);
    setMessages([]);
    setSelectedSkill(null);
    setSkillParameters({});
    setSkillParameterErrors({});
    if (assistantScope) saveStoredSessions(sessions, sessionId, assistantScope);
    setHistoryOpen(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const attachmentError = assistantAttachmentError(selectedModel, attachments.length + files.length);
    if (attachmentError) {
      toast.error(attachmentError);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    toast.info(files.length > 1 ? `正在上传 ${files.length} 个文件...` : "正在上传文件...");
    const uploaded: FileVO[] = [];

    for (const file of files) {
      try {
        const kind = referenceKindFromFile(file);
        const result = await uploadFileSmart(file, (progress) => setUploadProgress(progress), {
          maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
          label: kind === "video" ? "参考视频" : "参考文件",
        });
        if (result.success && result.data?.fileUrl) {
          uploaded.push(result.data);
        } else {
          toast.error(result.message || `上传失败：${file.name}`);
        }
      } catch (error) {
        toast.error(`上传失败：${(error as Error)?.message || file.name}`);
      }
    }

    if (uploaded.length) {
      setAttachments((current) => [...current, ...uploaded]);
      toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 个文件` : "文件已上传");
    }
    setUploading(false);
    setUploadProgress(0);
  };

  // 按下标移除:同一文件上传两次 fileUrl 相同,按 URL 过滤会一删删两条。
  // 删除会让其后的「图片N」整体前移，正文里已写下的 token 必须同步重写，
  // 否则会静默改指另一张图或越界。映射在 updater 之外算好（本文件约定：
  // state updater 里不做副作用），再一次性写回。
  const removeAttachment = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    const nextLabels = buildMentionRefs(next).refLabels;
    // nextLabels 对齐**新**数组，refLabels 对齐**旧**数组，长度差一。
    // 必须先把新标签映射回旧下标再配对：删掉 index 后，旧 k>index 落到新 k-1。
    const alignedNext = attachments.map((_, k) =>
      k === index ? null : nextLabels[k < index ? k : k - 1] ?? null,
    );
    const remapped = remapRefTokens(message, refLabels, alignedNext);
    setAttachments(next);
    if (remapped !== message) setMessage(remapped);
  };

  // 普通助手任务独立于当前会话恢复：切会话不取消，卸载只停本页 timer；
  // 刷新后会从持久化消息里的 frozen request/taskId 继续对账。
  const assistantUnmountedRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  // 挂载时复位:StrictMode 下 mount→unmount→remount,只在 cleanup 置 true
  // 会让重挂载后的轮询被永久判为"已卸载"而全部空转退出。
  useEffect(() => {
    const timers = assistantChatTimersRef.current;
    const inFlight = assistantChatInFlightRef.current;
    assistantUnmountedRef.current = false;
    return () => {
      assistantUnmountedRef.current = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      inFlight.clear();
    };
  }, []);

  const nextMessageId = (role: AssistantChatRole) => {
    messageSeqRef.current += 1;
    return role + "-" + Date.now() + "-" + messageSeqRef.current;
  };

  const patchMessage = (id: string, data: Partial<AssistantChatMessage>) => {
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...data } : item)));
  };

  const patchSessionMessage = useCallback((sessionId: string, id: string, data: Partial<AssistantChatMessage>) => {
    // Message ids are session-unique. Patching only when the id is visible also
    // covers the first response racing React's active-session effect.
    setMessages((current) => current.some((item) => item.id === id)
      ? current.map((item) => (item.id === id ? { ...item, ...data } : item))
      : current);
    setSessions((current) => current.map((session) => session.id === sessionId
      ? { ...session, messages: session.messages.map((item) => item.id === id ? { ...item, ...data } : item), updatedAt: Date.now() }
      : session));
  }, []);

  const clearAssistantChatRecovery = useCallback((job: AssistantChatRecoveryJob) => {
    const key = assistantChatRecoveryKey(job);
    const timer = assistantChatTimersRef.current.get(key);
    if (timer != null) window.clearTimeout(timer);
    assistantChatTimersRef.current.delete(key);
    assistantChatFailuresRef.current.delete(key);
    assistantChatReconnectNoticesRef.current.delete(key);
    assistantChatDeadlineNoticesRef.current.delete(key);
  }, []);

  const scheduleAssistantChatRecovery = useCallback((job: AssistantChatRecoveryJob, delay: number) => {
    if (assistantUnmountedRef.current || assistantRecoveryScopeRef.current !== job.scope) return;
    const key = assistantChatRecoveryKey(job);
    if (assistantChatInFlightRef.current.has(key) || assistantChatTimersRef.current.has(key)) return;
    const timer = window.setTimeout(() => {
      assistantChatTimersRef.current.delete(key);
      if (assistantRecoveryScopeRef.current !== job.scope) return;
      void runAssistantChatRecoveryRef.current(job);
    }, Math.max(0, delay));
    assistantChatTimersRef.current.set(key, timer);
  }, []);

  const runAssistantChatRecovery = useCallback(async (job: AssistantChatRecoveryJob): Promise<AssistantChatRecoveryOutcome> => {
    const key = assistantChatRecoveryKey(job);
    if (
      assistantUnmountedRef.current
      || assistantRecoveryScopeRef.current !== job.scope
      || assistantChatInFlightRef.current.has(key)
    ) return "active";
    assistantChatInFlightRef.current.add(key);
    let nextJob: AssistantChatRecoveryJob | null = null;
    let nextDelay = CHAT_POLL_INTERVAL;
    let outcome: AssistantChatRecoveryOutcome = "active";
    const beyondForegroundBudget = Date.now() - job.request.createdAt > CHAT_FOREGROUND_POLL_TIME;
    try {
      if (beyondForegroundBudget && !assistantChatDeadlineNoticesRef.current.has(key)) {
        assistantChatDeadlineNoticesRef.current.add(key);
        if (activeSessionIdRef.current === job.sessionId) toast.info("回复时间较长，仍在后台继续确认");
      }

      let task: AiTaskVO | null = null;
      if (!job.taskId) {
        const result = await aiApi.generateIdempotent({
          handler: ASSISTANT_HANDLER,
          modelId: job.request.modelId,
          input: job.request.input,
          clientRequestId: job.request.clientRequestId,
        }, `canvas-assistant:${job.sessionId}:${job.request.clientRequestId}`);
        if (assistantUnmountedRef.current || assistantRecoveryScopeRef.current !== job.scope) return "active";
        if (!result.success || !result.data?.id) {
          if (isAmbiguousAssistantCreateCode(result.code)) {
            const failures = (assistantChatFailuresRef.current.get(key) ?? 0) + 1;
            assistantChatFailuresRef.current.set(key, failures);
            if (!assistantChatReconnectNoticesRef.current.has(key)) {
              assistantChatReconnectNoticesRef.current.add(key);
              if (activeSessionIdRef.current === job.sessionId) toast.info("连接暂时中断，正在确认刚才的请求");
            }
            patchSessionMessage(job.sessionId, job.assistantId, {
              status: "pending",
              content: "请求已发送，正在确认任务状态…",
            });
            nextJob = job;
            nextDelay = assistantChatRetryDelay(failures, beyondForegroundBudget);
          } else {
            patchSessionMessage(job.sessionId, job.assistantId, {
              status: "error",
              content: result.message || "发送失败",
              chatRequest: undefined,
            });
            patchSessionMessage(job.sessionId, job.request.userMessageId, { includeInHistory: false });
            clearAssistantChatRecovery(job);
            outcome = "rejected";
          }
        } else {
          assistantChatFailuresRef.current.set(key, 0);
          task = result.data;
          const taskId = String(task.id);
          job = { ...job, taskId };
          patchSessionMessage(job.sessionId, job.assistantId, {
            taskId,
            status: "pending",
            content: "正在思考...",
          });
        }
      } else {
        const result = await aiApi.getTask(job.taskId);
        if (assistantUnmountedRef.current || assistantRecoveryScopeRef.current !== job.scope) return "active";
        if (!result.success || !result.data) {
          if (isTerminalAssistantLookupCode(result.code)) {
            patchSessionMessage(job.sessionId, job.assistantId, {
              status: "error",
              content: result.message || "无法继续获取回复",
              chatRequest: undefined,
            });
            clearAssistantChatRecovery(job);
            outcome = "completed";
          } else {
            const failures = (assistantChatFailuresRef.current.get(key) ?? 0) + 1;
            assistantChatFailuresRef.current.set(key, failures);
            if (!assistantChatReconnectNoticesRef.current.has(key)) {
              assistantChatReconnectNoticesRef.current.add(key);
              if (activeSessionIdRef.current === job.sessionId) toast.info("连接暂时中断，正在自动恢复回复状态");
            }
            nextJob = job;
            nextDelay = assistantChatRetryDelay(failures, beyondForegroundBudget);
          }
        } else {
          assistantChatFailuresRef.current.set(key, 0);
          task = result.data;
        }
      }

      if (task) {
        if (task.status === AiTaskStatus.SUCCESS) {
          patchSessionMessage(job.sessionId, job.assistantId, {
            status: "done",
            content: parseTaskResult(task),
            taskId: String(task.id),
            chatRequest: undefined,
          });
          patchSessionMessage(job.sessionId, job.request.userMessageId, { includeInHistory: true });
          clearAssistantChatRecovery(job);
          outcome = "completed";
        } else if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
          patchSessionMessage(job.sessionId, job.assistantId, {
            status: "error",
            content: task.errorMsg || "生成失败",
            taskId: String(task.id),
            chatRequest: undefined,
          });
          clearAssistantChatRecovery(job);
          outcome = "completed";
        } else {
          nextJob = { ...job, taskId: String(task.id) };
          nextDelay = beyondForegroundBudget ? 10_000 : CHAT_POLL_INTERVAL;
        }
      }
    } catch {
      if (assistantRecoveryScopeRef.current !== job.scope) return "active";
      const failures = (assistantChatFailuresRef.current.get(key) ?? 0) + 1;
      assistantChatFailuresRef.current.set(key, failures);
      nextJob = job;
      nextDelay = assistantChatRetryDelay(failures, beyondForegroundBudget);
    } finally {
      assistantChatInFlightRef.current.delete(key);
      if (
        nextJob
        && outcome === "active"
        && !assistantUnmountedRef.current
        && assistantRecoveryScopeRef.current === job.scope
      ) {
        scheduleAssistantChatRecovery(nextJob, nextDelay);
      }
    }
    return outcome;
  }, [clearAssistantChatRecovery, patchSessionMessage, scheduleAssistantChatRecovery]);
  useEffect(() => {
    runAssistantChatRecoveryRef.current = runAssistantChatRecovery;
  }, [runAssistantChatRecovery]);

  // Restore both the active and background sessions. Timer/in-flight maps make
  // this idempotent even though message persistence rerenders after each patch.
  useEffect(() => {
    if (!assistantScope || readySessionScope !== assistantScope) return;
    const candidates = new Map<string, { sessionId: string; message: AssistantChatMessage }>();
    for (const session of sessions) {
      for (const item of session.messages) {
        if (item.role === "assistant" && item.status === "pending" && item.chatRequest) {
          candidates.set(`${session.id}:${item.id}`, { sessionId: session.id, message: item });
        }
      }
    }
    for (const item of messages) {
      if (item.role === "assistant" && item.status === "pending" && item.chatRequest && activeSessionId) {
        candidates.set(`${activeSessionId}:${item.id}`, { sessionId: activeSessionId, message: item });
      }
    }
    for (const { sessionId, message: item } of candidates.values()) {
      scheduleAssistantChatRecovery({
        scope: assistantScope,
        sessionId,
        assistantId: item.id,
        request: item.chatRequest as AssistantChatRequestSnapshot,
        taskId: item.taskId,
      }, 0);
    }
  }, [activeSessionId, assistantScope, messages, readySessionScope, scheduleAssistantChatRecovery, sessions]);

  const materializeOne = (run: SkillRunVO, artifact: SkillRunArtifactVO) => {
    if (!projectId || String(run.projectId ?? "") !== projectId || useCanvasStore.getState().currentProjectId !== projectId) return;
    const state = useCanvasStore.getState();
    if (state.materializedArtifactIds.includes(artifact.id)) {
      toast.info("该结果已经在画布中");
      return;
    }
    const result = buildSkillArtifactNodes({
      run,
      artifacts: [artifact],
      nodes: state.nodes,
      sourceNodeIds: canvasSkillRunSourceNodeIds(run),
    });
    if (!result.nodes.length) {
      toast.info("该结果暂不支持转换为画布节点");
      return;
    }
    state.addNodesAndConnections(result.nodes, result.connections, result.nodes[0].id);
    state.markSkillArtifactsMaterialized(
      result.nodes.flatMap((node) => node.provenance?.artifactId ? [node.provenance.artifactId] : []),
    );
    void requestCanvasSave(projectId);
    toast.success("已添加到画布");
  };

  const sendMessage = async (options?: {
    skill?: SkillVO | null;
    prompt?: string;
    attachments?: FileVO[];
    parameters?: Record<string, unknown>;
    history?: AssistantChatMessage[];
    sessionId?: string;
    clientRequestId?: string;
    handoffId?: string;
  }) => {
    if (!assistantScope || readySessionScope !== assistantScope) {
      toast.info("助手正在准备当前画布，请稍后再试");
      return;
    }
    const text = (options?.prompt ?? message).trim();
    const currentAttachments = options?.attachments ?? attachments;
    const currentSkill = options?.skill === undefined ? selectedSkill : options.skill;
    const currentHistory = options?.history ?? messages;
    const currentParameters = options?.parameters ?? skillParameters;
    const hasCanvasSources = !!currentSkill && selectedNodeIds.size > 0;
    if ((!text && currentAttachments.length === 0 && !hasCanvasSources) || sendLockRef.current || sending || uploading) return;

    const attachmentError = assistantAttachmentError(selectedModel, currentAttachments.length);
    if (attachmentError) {
      toast.error(attachmentError);
      return;
    }

    for (const file of currentAttachments) {
      const kind = referenceKindFromMeta(file);
      const validationMessage = validateKnownFileSize(file.fileSize, file.originalName, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
        label: "参考文件",
      });
      if (validationMessage) { toast.error(validationMessage); return; }
    }

    const nextActiveSessionId = options?.sessionId || activeSessionId || createSessionId();
    const completedHistory = currentHistory
      .flatMap((item): SkillRunMessageInput[] => {
        const recoveredByRequest = item.clientRequestId
          ? runsByRequestId.get(item.clientRequestId)
          : undefined;
        if (item.includeInHistory === false && !recoveredByRequest) return [];
        if (item.role === "assistant" && (item.skillRunId || item.clientRequestId)) {
          const run = item.skillRunId
            ? runsById.get(item.skillRunId)
            : recoveredByRequest;
          if (!run || run.status !== "succeeded") return [];
          return [{
            role: "assistant",
            content: skillRunHistoryContent(run, item.skillTitle),
          }];
        }
        return item.status === "done" && item.content.trim()
          ? [{ role: item.role, content: messageContentForHistory(item) }]
          : [];
      })
      .slice(-40);

    if (currentSkill) {
      if (utf8Length(text) > MAX_SKILL_PROMPT_BYTES) {
        toast.error("创作描述过长，请精简到 32KB 以内");
        return;
      }
      if (!projectId) {
        toast.error("画布尚未准备好，请稍后重试");
        return;
      }
      const snapshot = useCanvasStore.getState();
      if (snapshot.currentProjectId !== projectId) {
        toast.error("画布已切换，请在当前画布重新发送");
        return;
      }
      const currentSkillKind = skillKindOf(currentSkill);
      const runParameters = { ...currentParameters };
      if (currentSkillKind === "agent" && selectedModel?.modelId && !runParameters.textModelId) {
        runParameters.textModelId = selectedModel.modelId;
      }
      const previousResultAssets = currentSkillKind === "agent"
        ? currentHistory
          .flatMap((item) => {
            if (item.role !== "assistant") return [];
            const run = item.skillRunId
              ? runsById.get(item.skillRunId)
              : item.clientRequestId
                ? runsByRequestId.get(item.clientRequestId)
                : undefined;
            return run ? [run] : [];
          })
          .filter((run): run is SkillRunVO => !!run && run.status === "succeeded")
          .flatMap((run) => canvasSkillRunArtifacts(run)
            .filter((artifact) => artifact.isFinal !== false && !!artifact.url)
            .map((artifact) => ({
              id: artifact.id,
              type: artifact.type,
              url: artifact.url,
              role: "previous_result",
              name: artifact.title || run.skillTitle || "上一轮结果",
              metadata: { runId: run.id, artifactId: artifact.id },
            })))
          .slice(-16)
        : [];
      const input = buildCanvasSkillRunInput(snapshot, {
        sourceNodeIds: Array.from(selectedNodeIds),
        prompt: text,
        parameters: runParameters,
        assets: filesToSkillAssets(currentAttachments),
      });
      if (input.sourceNodeIds.length > MAX_SKILL_SOURCE_NODES) {
        toast.error(`一次最多引用 ${MAX_SKILL_SOURCE_NODES} 个画布节点，请减少选择后重试`);
        return;
      }
      const currentAssets = uniqueSkillAssets(input.assets);
      if (currentAssets.length > MAX_SKILL_ASSETS) {
        toast.error(`当前附件和画布节点共展开为 ${currentAssets.length} 个素材，一次最多使用 ${MAX_SKILL_ASSETS} 个`);
        return;
      }
      // Current attachments and selected nodes have priority; older Agent results only fill spare slots.
      input.assets = uniqueSkillAssets([...currentAssets, ...previousResultAssets]).slice(0, MAX_SKILL_ASSETS);
      if (currentSkillKind === "agent") input.messages = trimSkillHistory(completedHistory);
      const errors = validateSkillRunInputValues(currentSkill.inputSchema, input);
      if (Object.keys(errors).length) {
        setSkillParameterErrors(errors);
        toast.info(errors.prompt || errors.assets || errors.sourceNodeIds || errors.parameters || "请补充技能需要的信息");
        return;
      }

      const sourceTypes = [...new Set(snapshot.nodes
        .filter((node) => input.sourceNodeIds.includes(node.id))
        .map((node) => node.type))];
      const targetType = sourceTypes.length === 1 ? sourceTypes[0] : undefined;
      const matchingHandoff = pendingHandoffRef.current?.skillId === currentSkill.id
        ? pendingHandoffRef.current
        : null;
      const handoffId = options?.handoffId || matchingHandoff?.id;
      const requestFingerprint = JSON.stringify({ skillId: currentSkill.id, targetType, input });
      const retry = pendingSkillRetryRef.current?.fingerprint === requestFingerprint
        ? pendingSkillRetryRef.current
        : null;
      const clientRequestId = options?.clientRequestId
        || matchingHandoff?.clientRequestId
        || retry?.clientRequestId
        || createCanvasSkillClientRequestId();
      if (!handoffId) pendingSkillRetryRef.current = { fingerprint: requestFingerprint, clientRequestId };
      const userMessage: AssistantChatMessage = {
        id: nextMessageId("user"),
        role: "user",
        content: text || `请使用「${currentSkill.title}」处理已选内容`,
        attachments: currentAttachments,
        status: "done",
        clientRequestId,
      };
      const assistantId = nextMessageId("assistant");
      const assistantMessage: AssistantChatMessage = {
        id: assistantId,
        role: "assistant",
        content: `正在启动「${currentSkill.title}」…`,
        status: "pending",
        skillTitle: currentSkill.title,
        clientRequestId,
      };

      if (nextActiveSessionId !== activeSessionId) setActiveSessionId(nextActiveSessionId);
      sendLockRef.current = true;
      setMessages((current) => [...current, userMessage, assistantMessage]);
      setMessage("");
      setAttachments([]);
      setSkillParameterErrors({});
      setOpen(true);
      setSending(true);

      try {
        const run = await createRun({
          skillId: currentSkill.id,
          entryPoint: "canvas",
          targetType,
          projectId,
          clientRequestId,
          input,
        });
        const current = useCanvasStore.getState();
        if (current.currentProjectId !== projectId) throw new Error("画布已切换；运行已保留在原画布");
        current.trackSkillRun(run.id);
        for (const sourceNodeId of input.sourceNodeIds) current.updateNode(sourceNodeId, { skillRunId: run.id });
        patchMessage(assistantId, {
          skillRunId: run.id,
          skillTitle: run.skillTitle || currentSkill.title,
          content: `「${run.skillTitle || currentSkill.title}」正在执行。`,
        });
        if (handoffId && pendingHandoffRef.current?.id === handoffId) {
          pendingHandoffRef.current = { ...pendingHandoffRef.current, runId: run.id };
        }
        const committed = await persistCanvasRunAndCommit(projectId, run.id);
        if (committed && handoffId) consumeCanvasHandoff(handoffId);
        if (pendingSkillRetryRef.current?.clientRequestId === clientRequestId) pendingSkillRetryRef.current = null;
      } catch (error) {
        patchMessage(assistantId, { status: "error", content: (error as Error)?.message || "技能启动失败" });
        patchMessage(userMessage.id, { includeInHistory: false });
        setMessage((current) => current || text);
        setAttachments((current) => current.length ? current : currentAttachments);
      } finally {
        sendLockRef.current = false;
        setSending(false);
      }
      return;
    }

    const userMessage: AssistantChatMessage = {
      id: nextMessageId("user"),
      role: "user",
      content: text || "请分析这些附件并给出创作建议",
      attachments: currentAttachments,
      status: "done",
      // Do not feed a half-finished turn into a concurrent/retried request. It
      // becomes history only after the matching assistant task succeeds.
      includeInHistory: false,
    };
    const assistantId = nextMessageId("assistant");
    const clientRequestId = createAssistantChatClientRequestId();
    const chatRequest: AssistantChatRequestSnapshot = {
      clientRequestId,
      userMessageId: userMessage.id,
      modelId: selectedModel?.modelId ?? "default",
      input: {
        prompt: userMessage.content,
        messages: completedHistory,
        attachments: currentAttachments.map((file) => ({
          name: file.originalName,
          url: file.fileUrl,
          type: file.fileType,
          mimeType: file.mimeType,
          size: file.fileSize,
        })),
      },
      createdAt: Date.now(),
    };
    const assistantMessage: AssistantChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在思考...",
      status: "pending",
      clientRequestId,
      chatRequest,
    };

    const optimisticMessages = normalizeStoredMessages([...currentHistory, userMessage, assistantMessage]);
    const existingSession = sessions.find((session) => session.id === nextActiveSessionId);
    const now = Date.now();
    const optimisticSession: AssistantStoredSession = {
      id: nextActiveSessionId,
      title: sessionTitleFromMessages(optimisticMessages),
      messages: optimisticMessages,
      selectedSkill: null,
      skillParameters: {},
      createdAt: existingSession?.createdAt ?? now,
      updatedAt: now,
    };
    const optimisticSessions = normalizeStoredSessions([
      optimisticSession,
      ...sessions.filter((session) => session.id !== nextActiveSessionId),
    ]);
    if (!persistAssistantChatBeforeCreate(
      optimisticSessions,
      nextActiveSessionId,
      assistantScope,
      assistantId,
      chatRequest,
    )) {
      toast.error("无法保存本次请求，尚未发起生成；请清理浏览器存储后重试");
      return;
    }

    sendLockRef.current = true;
    if (nextActiveSessionId !== activeSessionId) setActiveSessionId(nextActiveSessionId);
    setSessions(optimisticSessions);
    setMessages(optimisticMessages);
    setMessage("");
    setAttachments([]);
    setSending(true);

    try {
      const outcome = await runAssistantChatRecovery({
        scope: assistantScope,
        sessionId: nextActiveSessionId,
        assistantId,
        request: chatRequest,
      });
      if (outcome === "rejected") {
        setMessage((current) => current || text);
        setAttachments((current) => current.length ? current : currentAttachments);
      }
    } catch (error) {
      // The recovery runner normally absorbs transport failures and schedules a
      // retry. This guard only covers an unexpected local exception.
      patchSessionMessage(nextActiveSessionId, assistantId, {
        status: "pending",
        content: (error as Error)?.message || "请求已发送，正在继续确认…",
      });
      scheduleAssistantChatRecovery({
        scope: assistantScope,
        sessionId: nextActiveSessionId,
        assistantId,
        request: chatRequest,
      }, 1_500);
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  useEffect(() => {
    if (
      !assistantScope ||
      readySessionScope !== assistantScope ||
      !persistenceReady ||
      !projectId ||
      !launchJournal ||
      launchJournal.projectId !== projectId ||
      handoffHandledRef.current === launchJournal.id ||
      !launchJournal.selectedSkill
    ) return;

    handoffHandledRef.current = launchJournal.id;
    const skill = launchJournal.selectedSkill;
    const parameters = canvasLaunchSkillParameters(launchJournal, skill);
    const recoveredRun = runs.find((run) =>
      run.clientRequestId === launchJournal.clientRequestId &&
      run.entryPoint === "canvas" &&
      String(run.projectId ?? "") === projectId,
    );
    pendingHandoffRef.current = {
      id: launchJournal.id,
      clientRequestId: launchJournal.clientRequestId,
      skillId: skill.id,
      ...(recoveredRun ? { runId: recoveredRun.id } : {}),
    };
    const nextSessionId = createSessionId();
    setActiveSessionId(nextSessionId);
    setMessages(recoveredRun ? [
      {
        id: nextMessageId("user"),
        role: "user",
        content: launchJournal.prompt || `请使用「${skill.title}」开始创作`,
        attachments: launchJournal.attachments,
        status: "done",
        clientRequestId: launchJournal.clientRequestId,
      },
      {
        id: nextMessageId("assistant"),
        role: "assistant",
        content: `「${recoveredRun.skillTitle || skill.title}」运行已恢复。`,
        status: "done",
        skillRunId: recoveredRun.id,
        skillTitle: recoveredRun.skillTitle || skill.title,
        clientRequestId: launchJournal.clientRequestId,
      },
    ] : []);
    setMessage(launchJournal.prompt);
    setAttachments(launchJournal.attachments);
    setSelectedSkill(skill);
    setSkillParameters(parameters);
    setSkillParameterErrors({});
    setOpen(true);

    if (launchJournal.state === "failed") {
      toast.error(launchJournal.error || "自动创作未完成，请修改后重试");
      consumeCanvasHandoff(launchJournal.id);
      return;
    }

    if (recoveredRun) {
      void persistCanvasRunAndCommit(projectId, recoveredRun.id).then((committed) => {
        if (committed) consumeCanvasHandoff(launchJournal.id);
      });
      return;
    }

    if (!launchJournal.canvasMode) return;

    queueMicrotask(() => {
      void sendMessage({
        skill,
        prompt: launchJournal.prompt,
        attachments: launchJournal.attachments,
        parameters,
        history: [],
        sessionId: nextSessionId,
        clientRequestId: launchJournal.clientRequestId,
        handoffId: launchJournal.id,
      });
    });
    // sendMessage deliberately reads the fully initialized handoff snapshot above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantScope, consumeCanvasHandoff, launchJournal, persistenceReady, projectId, readySessionScope, runs]);

  // 回车发送 / Shift+回车换行、以及中文输入法合成态不误发，都由 PromptRefEditor
  // 内部处理（它还要在 @ 菜单打开时把回车让给候选选中），这里只提供 onSubmit。

  const canSubmit = Boolean(message.trim() || attachments.length || (selectedSkill && selectedNodeIds.size))
    && !!assistantScope
    && readySessionScope === assistantScope
    && !sending
    && !uploading;

  if (!open) {
    return (
      <button
        ref={assistantLauncherRef}
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[70] flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950 text-white shadow-xl shadow-neutral-900/25 transition-transform hover:scale-105 hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
        title="AI 小助手"
      >
        <Bot className="h-5 w-5" />
      </button>
    );
  }

  return (
    <>
    <aside
      ref={assistantPanelRef}
      className="fixed bottom-4 right-4 z-[70] flex h-[calc(100vh-32px)] flex-col overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-50 text-neutral-950 shadow-none outline-none ring-0 dark:border-white/10 dark:bg-[#18191d] dark:text-white"
      style={{ width: displayWidth }}
    >
      <div
        className="absolute left-0 top-0 z-20 h-full w-4 cursor-ew-resize bg-transparent"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-valuenow={Math.round(panelWidth)}
        onPointerEnter={() => setResizeHover(true)}
        onPointerLeave={() => {
          if (!resizingRef.current) setResizeHover(false);
        }}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => {
          if (!resizingRef.current) setResizeHover(false);
        }}
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setExpanded(false);
          setPanelWidth((current) => clampPanelWidth(current + (event.key === "ArrowLeft" ? 24 : -24)));
        }}
        aria-label="拖动调整宽度"
      >
        <span
          className={((resizing || resizeHover) ? "opacity-100" : "opacity-0") + " pointer-events-none absolute left-0 top-0 h-full w-[3px] bg-neutral-300 transition-opacity dark:bg-neutral-600"}
        />
        <span
          className={((resizing || resizeHover) ? "opacity-100" : "opacity-0") + " pointer-events-none absolute left-[7px] top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full bg-neutral-400/70 transition-opacity dark:bg-neutral-500/80"}
        />
        <span className={((resizing || resizeHover) ? "opacity-100" : "opacity-0") + " pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 shadow-sm transition-opacity dark:border-white/10 dark:bg-[#25262b] dark:text-neutral-200"}>
          拖动调整宽度
        </span>
      </div>

      <div className="relative flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200/70 px-4 text-neutral-600 dark:border-white/8 dark:text-neutral-200">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {selectedSkill?.title || "AI 助手"}
          </div>
          <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {selectedSkillKind ? `${SKILL_KIND_LABEL[selectedSkillKind]} · 在对话中执行并写入画布` : "对话、分析与创作"}
          </div>
        </div>
        {(runsLoading || runs.some((run) => isSkillRunActive(run.status))) && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400" aria-live="polite">
            <Loader2 className="h-3 w-3 animate-spin" />
            {runsLoading ? "恢复中" : "执行中"}
          </span>
        )}
        <div className="relative" ref={historyMenuRef}>
          <button
            type="button"
            disabled={sending}
            onClick={() => setHistoryOpen((value) => !value)}
            className="rounded-lg p-1.5 transition-colors hover:bg-neutral-200/70 dark:hover:bg-white/10"
            title="历史会话"
            aria-expanded={historyOpen}
          >
            <Menu className="h-4 w-4" />
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-xl bg-white py-1 text-sm text-neutral-800 shadow-xl ring-1 ring-neutral-200/80 dark:bg-[#25262b] dark:text-neutral-100 dark:ring-white/10">
              <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">历史会话</div>
              <div className="max-h-52 overflow-y-auto">
                {sessions.length ? sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    disabled={sending}
                    onClick={() => selectSession(session)}
                    className={(session.id === activeSessionId ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white" : "text-neutral-700 dark:text-neutral-200") + " block w-full px-3 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/8"}
                    title={session.title}
                  >
                    <span className="block truncate">{session.title}</span>
                  </button>
                )) : (
                  <div className="px-3 py-3 text-sm text-neutral-400 dark:text-neutral-500">暂无历史会话</div>
                )}
              </div>
              <button
                type="button"
                disabled={sending}
                onClick={startNewSession}
                className="block w-full border-t border-neutral-100 px-3 py-2 text-left text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-white/8 dark:text-neutral-200 dark:hover:bg-white/8"
              >
                新建会话
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-lg p-1.5 transition-colors hover:bg-neutral-200/70 dark:hover:bg-white/10"
          title={expanded ? "收起" : "展开"}
          aria-pressed={expanded}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 transition-colors hover:bg-neutral-200/70 dark:hover:bg-white/10"
          title="收起助手"
          aria-label="收起助手"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4">
        <div className={(messages.length ? "justify-start" : "justify-center pb-8") + " flex min-h-0 flex-1 flex-col"}>
          {messages.length === 0 ? (
            <div className="mx-auto w-full max-w-[330px]">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 dark:border-white/10 dark:bg-white/6 dark:text-neutral-200">
                {selectedSkill ? <Wand2 className="h-[18px] w-[18px]" /> : <Sparkles className="h-[18px] w-[18px]" />}
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-neutral-950 dark:text-neutral-100">
                {selectedSkill ? `和「${selectedSkill.title}」一起创作` : "从一句话开始创作"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                {selectedSkill ? "说清目标，技能会在对话中持续执行，并把结果放到当前画布。" : "直接提问，或从输入框下方选择技能执行生成任务。"}
              </p>
              <ul className="mt-6 space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
                {SUGGESTIONS.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="h-1 w-1 rounded-full bg-neutral-400 dark:bg-neutral-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 pr-1">
              <div className="space-y-4 pt-2">
                {messages.map((item) => {
                  const isUser = item.role === "user";
                  const skillRun = item.skillRunId
                    ? runsById.get(item.skillRunId)
                    : item.clientRequestId
                      ? runsByRequestId.get(item.clientRequestId)
                      : undefined;
                  if (!isUser && skillRun) {
                    return (
                      <div key={item.id} className="w-full">
                        <SkillRunPanel
                          run={skillRun}
                          compact
                          actionBusy={actionBusy.has(skillRun.id)}
                          artifactActionLabel={(artifact) => materializedArtifactIds.includes(artifact.id) ? "已在画布" : "添加到画布"}
                          onAction={async (action, payload) => {
                            try {
                              await performAction(skillRun.id, {
                                action,
                                input: payload?.input,
                                feedback: payload?.feedback,
                              });
                            } catch (error) {
                              toast.error((error as Error)?.message || "操作失败，请重试");
                            }
                          }}
                          onArtifact={(artifact) => materializeOne(skillRun, artifact)}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={item.id} className={(isUser ? "justify-end" : "justify-start") + " flex"}>
                      <div
                        className={(isUser
                          ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
                          : item.status === "error"
                            ? "bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20"
                            : "bg-white text-neutral-900 ring-1 ring-neutral-200/70 dark:bg-[#24252a] dark:text-neutral-100 dark:ring-white/8") + " max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm"}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {item.status === "pending" && (
                            <span className="mr-2 inline-flex align-[-2px]">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            </span>
                          )}
                          {item.content}
                        </div>
                        {item.attachments && item.attachments.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {item.attachments.map((file, fileIndex) => (
                              <div
                                key={`${file.fileUrl}-${fileIndex}`}
                                className={(isUser ? "bg-white/12 text-white/85 dark:bg-neutral-950/8 dark:text-neutral-700" : "bg-neutral-50 text-neutral-600 dark:bg-white/6 dark:text-neutral-300") + " flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                                <span className="shrink-0 opacity-70">{formatFileSize(file.fileSize)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 rounded-2xl bg-white p-3 shadow-sm outline-none ring-1 ring-neutral-200/70 dark:bg-[#28292e] dark:ring-white/8">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          {selectedSkill && (
            <div className="mb-3 border-b border-neutral-100 pb-3 dark:border-white/8">
              {selectedNodeIds.size > 0 && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-white/6 dark:text-neutral-300">
                  <span>将引用当前选中的 {selectedNodeIds.size} 个画布节点</span>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => useCanvasStore.getState().clearSelection()}
                    className="shrink-0 rounded-md px-1.5 py-1 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    取消引用
                  </button>
                </div>
              )}
              <div className="max-h-40 overflow-y-auto pr-1">
                <SkillInputFields
                  schema={selectedSkill.inputSchema}
                  values={skillParameters}
                  errors={skillParameterErrors}
                  onChange={(key, value) => {
                    setSkillParameters((current) => ({ ...current, [key]: value }));
                    setSkillParameterErrors((current) => {
                      if (!current[key]) return current;
                      const next = { ...current };
                      delete next[key];
                      return next;
                    });
                  }}
                  disabled={sending}
                  compact
                />
              </div>
              {(skillParameterErrors.prompt || skillParameterErrors.assets || skillParameterErrors.sourceNodeIds || skillParameterErrors.parameters) && (
                <p className="mt-2 text-xs leading-5 text-red-600 dark:text-red-300">
                  {skillParameterErrors.prompt || skillParameterErrors.assets || skillParameterErrors.sourceNodeIds || skillParameterErrors.parameters}
                </p>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <div
                  key={`${file.fileUrl}-${index}`}
                  className="flex max-w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-xs text-neutral-700 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-200 dark:ring-white/10"
                  title={file.originalName}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                  <div className="min-w-0">
                    <div className="max-w-[210px] truncate font-medium">{file.originalName}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {/* 可 @ 引用的图片标出编号，与正文里的「图片N」对应 */}
                      {refLabels[index] ? `${refLabels[index]} · ` : ""}
                      {formatFileSize(file.fileSize)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white"
                    title="移除文件"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploading && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-300 dark:ring-white/10">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>上传中{uploadProgress > 0 ? ` ${uploadProgress}%` : ""}</span>
            </div>
          )}
          <div className="relative">
            <div className="flex min-w-0 items-start gap-2 pr-8">
              {selectedSkill && (
                <SkillPromptChip skill={selectedSkill} onRemove={clearSkill} className="mt-px" />
              )}
              <div className="min-w-0 flex-1">
                <PromptRefEditor
                  value={message}
                  onChange={setMessage}
                  refs={mentionRefs}
                  ariaLabel="给画布 AI 助手发送消息"
                  // 附件卡片已带「图片N」角标，不再重复一行缩略图
                  showThumbs={false}
                  placeholder={selectedSkill ? `告诉「${selectedSkill.title}」要完成什么` : "描述你的想法，或选择技能开始创作"}
                  onSubmit={() => { if (canSubmit) void sendMessage(); }}
                  editorClassName="block w-full overflow-y-auto whitespace-pre-wrap break-words rounded-none border-0 bg-transparent p-0 text-sm leading-5 text-neutral-900 outline-none ring-0 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 dark:text-neutral-100"
                  editorStyle={{
                    minHeight: inputExpanded ? 180 : 64,
                    maxHeight: inputExpanded ? 360 : 160,
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInputExpanded((value) => !value)}
              className="absolute right-0 top-0 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
              title={inputExpanded ? "收起输入区" : "放大输入区"}
            >
              {inputExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 basis-[260px] flex-1 flex-wrap items-center gap-1 text-sm text-neutral-700 dark:text-neutral-300">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || uploading}
                className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                title="上传文件"
                aria-label="上传文件"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
              {selectedSkillKind === "preset" ? (
                <span className="shrink-0 px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400">使用技能预设</span>
              ) : modelsLoading ? (
                <span className="flex h-8 shrink-0 items-center px-2 text-xs text-neutral-500 dark:text-neutral-400" role="status">
                  加载模型...
                </span>
              ) : (
                <ModelPicker
                  models={models}
                  value={selectedModel?.modelId ?? ""}
                  onChange={(modelId) => {
                    const model = models.find((item) => item.modelId === modelId);
                    if (model) selectModel(model);
                  }}
                  triggerLabel="模型"
                  showType
                />
              )}
              <div className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => setSkillPickerOpen(true)}
                  className={(selectedSkill
                    ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10") + " inline-flex min-w-0 max-w-[128px] items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition-colors"}
                  title={selectedSkill ? `当前技能：${selectedSkill.title}` : "选择技能"}
                  aria-haspopup="dialog"
                  aria-expanded={skillPickerOpen}
                >
                  <Wand2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{selectedSkill ? "技能 1" : "技能"}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                </button>
              </div>
            </div>
            <div className="ml-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-neutral-50 px-2 pl-3 shadow-sm ring-1 ring-neutral-100 dark:bg-[#303137] dark:ring-white/8">
              <span className="flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
                <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                {pointLabel}
              </span>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => { void sendMessage(); }}
                className={(canSubmit
                  ? "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  : "bg-neutral-100 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-500") + " flex h-8 w-8 items-center justify-center rounded-full transition-colors"}
                title={uploading ? "附件上传中…" : sending ? "发送中…" : !canSubmit ? "先输入内容或添加附件" : "发送"}
                aria-label={uploading ? "附件上传中" : sending ? "发送中" : "发送消息"}
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
    <SkillPicker
      open={skillPickerOpen}
      onClose={() => setSkillPickerOpen(false)}
      onPick={pickSkill}
      currentId={selectedSkill?.id}
      kinds={["preset", "agent"]}
      entryPoint="canvas"
      targetType={assistantTargetType}
    />
    </>
  );
}
