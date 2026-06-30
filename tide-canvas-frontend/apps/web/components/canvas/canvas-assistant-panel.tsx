"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronDown, ChevronRight, Expand, FileText, Loader2, Maximize2, Menu, Minimize2, Plus, Sparkles, X, Zap } from "lucide-react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { referenceKindFromFile, referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { toast } from "@/components/shared/toast";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import type { FileVO } from "@/types/file";

const SUGGESTIONS = [
  "优化创意提示词",
  "构思分镜脚本",
  "让想法走向画面",
  "帮你点亮灵感~",
];


const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 460;
const ASSISTANT_MODEL_STORAGE_KEY = "tc:assistant:modelId";
const ASSISTANT_SESSION_STORAGE_KEY = "tc:assistant:session";
const ASSISTANT_SESSIONS_STORAGE_KEY = "tc:assistant:sessions";
const ASSISTANT_ACTIVE_SESSION_STORAGE_KEY = "tc:assistant:activeSessionId";
const ASSISTANT_HANDLER = "assistant_chat";
const CHAT_POLL_INTERVAL = 1500;
const MAX_CHAT_POLL_TIME = 60 * 1000;
const MAX_STORED_MESSAGES = 80;
const MAX_STORED_SESSIONS = 20;

type AssistantChatRole = "user" | "assistant";
type AssistantChatStatus = "done" | "pending" | "error";

interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  attachments?: FileVO[];
  status: AssistantChatStatus;
}

interface AssistantStoredSession {
  id: string;
  title: string;
  messages: AssistantChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface AssistantStoredSessionsPayload {
  sessions: AssistantStoredSession[];
  activeSessionId?: string;
}

function clampPanelWidth(width: number) {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / 1024 / 1024).toFixed(1) + " MB";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeStoredMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .filter((item) => item.content.trim() || item.attachments?.length)
    .map((item) => ({
      ...item,
      status: item.status === "pending" ? "error" as const : item.status,
      content: item.status === "pending" ? "上次回复中断，请重新发送。" : item.content,
    }))
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
        createdAt,
        updatedAt,
      } satisfies AssistantStoredSession;
    })
    .filter((item): item is AssistantStoredSession => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_SESSIONS);
}

function loadStoredSessions() {
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

function saveStoredSessions(sessions: AssistantStoredSession[], activeSessionId: string) {
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

export function CanvasAssistantPanel() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [sessions, setSessions] = useState<AssistantStoredSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [attachments, setAttachments] = useState<FileVO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSeqRef = useRef(0);
  const sessionLoadedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.max(56, input.scrollHeight) + "px";
  }, [message]);

  useEffect(() => {
    const restored = loadStoredSessions();
    setSessions(restored.sessions);
    setActiveSessionId(restored.activeSessionId);
    const activeSession = restored.sessions.find((session) => session.id === restored.activeSessionId);
    if (activeSession) {
      setMessages(activeSession.messages);
      messageSeqRef.current = activeSession.messages.length;
    }
    sessionLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!sessionLoadedRef.current) return;
    const normalized = normalizeStoredMessages(messages);
    setSessions((current) => {
      let next = current;
      let nextActiveSessionId = activeSessionId;
      if (normalized.length) {
        nextActiveSessionId = activeSessionId || createSessionId();
        if (!activeSessionId) setActiveSessionId(nextActiveSessionId);
        const existing = current.find((session) => session.id === nextActiveSessionId);
        const now = Date.now();
        const savedSession: AssistantStoredSession = {
          id: nextActiveSessionId,
          title: sessionTitleFromMessages(normalized),
          messages: normalized,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        next = [savedSession, ...current.filter((session) => session.id !== nextActiveSessionId)]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_STORED_SESSIONS);
      }
      saveStoredSessions(next, nextActiveSessionId);
      return next;
    });
  }, [messages, activeSessionId]);

  useEffect(() => {
    if (!open) {
      setHistoryOpen(false);
      setModelOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    aiApi
      .listModels()
      .then((res) => {
        if (cancelled || !res.success) return;
        const enabled = res.data ?? [];
        const textModels = enabled.filter((model) => model.type === AiModelType.TEXT);
        const usable = textModels.length ? textModels : enabled;
        setModels(usable);

        const saved = typeof window !== "undefined" ? localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) : null;
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
  }, []);

  useEffect(() => {
    if (!historyOpen && !modelOpen) return;

    const handleOutsideClick = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyMenuRef.current?.contains(target) || modelMenuRef.current?.contains(target)) return;
      setHistoryOpen(false);
      setModelOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsideClick, true);
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick, true);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [historyOpen, modelOpen]);

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
    };

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [panelWidth]);

  const displayWidth = expanded ? "min(720px, calc(100vw - 32px))" : "min(" + panelWidth + "px, calc(100vw - 32px))";
  const selectedModel = models.find((model) => model.modelId === selectedModelId) ?? models[0];
  const selectedPointCost = Number(selectedModel?.pointCost ?? 0);
  const pointLabel = selectedPointCost > 0 ? selectedPointCost.toLocaleString() : "免费";

  const selectModel = (model: AiModelVO) => {
    setSelectedModelId(model.modelId);
    setModelOpen(false);
    if (typeof window !== "undefined") localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, model.modelId);
  };

  const selectSession = (session: AssistantStoredSession) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setMessage("");
    setAttachments([]);
    messageSeqRef.current = Math.max(messageSeqRef.current, session.messages.length);
    saveStoredSessions(sessions, session.id);
    setHistoryOpen(false);
  };

  const startNewSession = () => {
    const sessionId = createSessionId();
    setActiveSessionId(sessionId);
    setMessage("");
    setAttachments([]);
    setMessages([]);
    saveStoredSessions(sessions, sessionId);
    setHistoryOpen(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

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

  const removeAttachment = (fileUrl: string) => {
    setAttachments((current) => current.filter((file) => file.fileUrl !== fileUrl));
  };

  const nextMessageId = (role: AssistantChatRole) => {
    messageSeqRef.current += 1;
    return role + "-" + Date.now() + "-" + messageSeqRef.current;
  };

  const patchMessage = (id: string, data: Partial<AssistantChatMessage>) => {
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...data } : item)));
  };

  const pollTask = async (taskId: string | number, assistantId: string) => {
    const deadline = Date.now() + MAX_CHAT_POLL_TIME;
    while (Date.now() < deadline) {
      await wait(CHAT_POLL_INTERVAL);
      const res = await aiApi.getTask(taskId);
      if (!res.success) {
        patchMessage(assistantId, { status: "error", content: res.message || "获取回复失败" });
        return;
      }
      const task = res.data;
      if (task.status === AiTaskStatus.SUCCESS) {
        patchMessage(assistantId, { status: "done", content: parseTaskResult(task) });
        return;
      }
      if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
        patchMessage(assistantId, { status: "error", content: task.errorMsg || "生成失败" });
        return;
      }
    }
    patchMessage(assistantId, { status: "error", content: "回复超时，请稍后重试。" });
  };

  const sendMessage = async () => {
    const text = message.trim();
    const currentAttachments = attachments;
    if ((!text && currentAttachments.length === 0) || sending || uploading) return;

    for (const file of currentAttachments) {
      const kind = referenceKindFromMeta(file);
      const message = validateKnownFileSize(file.fileSize, file.originalName, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
        label: "参考文件",
      });
      if (message) { toast.error(message); return; }
    }    const nextActiveSessionId = activeSessionId || createSessionId();
    if (!activeSessionId) setActiveSessionId(nextActiveSessionId);
    const history = messages
      .filter((item) => item.status === "done")
      .map((item) => ({ role: item.role, content: messageContentForHistory(item) }));
    const userMessage: AssistantChatMessage = {
      id: nextMessageId("user"),
      role: "user",
      content: text || "请分析这些附件并给出创作建议",
      attachments: currentAttachments,
      status: "done",
    };
    const assistantId = nextMessageId("assistant");
    const assistantMessage: AssistantChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在思考...",
      status: "pending",
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setMessage("");
    setAttachments([]);
    setSending(true);

    try {
      const res = await aiApi.generate({
        handler: ASSISTANT_HANDLER,
        modelId: selectedModel?.modelId ?? "default",
        input: {
          prompt: userMessage.content,
          messages: history,
          attachments: currentAttachments.map((file) => ({
            name: file.originalName,
            url: file.fileUrl,
            type: file.fileType,
            mimeType: file.mimeType,
            size: file.fileSize,
          })),
        },
      });

      if (!res.success) {
        patchMessage(assistantId, { status: "error", content: res.message || "发送失败" });
        return;
      }

      const task = res.data;
      if (task.status === AiTaskStatus.SUCCESS) {
        patchMessage(assistantId, { status: "done", content: parseTaskResult(task) });
      } else if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
        patchMessage(assistantId, { status: "error", content: task.errorMsg || "生成失败" });
      } else {
        await pollTask(task.id, assistantId);
      }
    } catch (error) {
      patchMessage(assistantId, { status: "error", content: (error as Error)?.message || "发送失败" });
    } finally {
      setSending(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const canSubmit = Boolean(message.trim() || attachments.length) && !sending && !uploading;

  if (!open) {
    return (
      <button
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
    <aside
      className="fixed bottom-4 right-4 z-[70] flex h-[calc(100vh-32px)] flex-col overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-50 text-neutral-950 shadow-none outline-none ring-0 dark:border-white/10 dark:bg-[#18191d] dark:text-white"
      style={{ width: displayWidth }}
    >
      <div
        className="absolute left-0 top-0 z-20 h-full w-4 cursor-ew-resize bg-transparent"
        onPointerEnter={() => setResizeHover(true)}
        onPointerLeave={() => {
          if (!resizingRef.current) setResizeHover(false);
        }}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => {
          if (!resizingRef.current) setResizeHover(false);
        }}
        onPointerDown={beginResize}
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

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute -left-7 top-14 z-30 flex h-12 w-7 items-center justify-center rounded-l-lg border border-neutral-200/70 border-r-0 bg-neutral-50 text-red-500 shadow-none outline-none ring-0 transition-colors hover:bg-neutral-100 hover:text-red-400 dark:border-white/10 dark:bg-[#18191d] dark:text-red-400 dark:hover:bg-[#222329] dark:hover:text-red-300"
        title="收起助手"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="relative flex h-12 shrink-0 items-center justify-end gap-2 px-4 text-neutral-600 dark:text-neutral-200">
        <div className="relative" ref={historyMenuRef}>
          <button
            type="button"
            onClick={() => {
              setHistoryOpen((value) => !value);
              setModelOpen(false);
            }}
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
                onClick={startNewSession}
                className="block w-full border-t border-neutral-100 px-3 py-2 text-left text-red-500 transition-colors hover:bg-red-50 dark:border-white/8 dark:hover:bg-red-500/10"
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4">
        <div className={(messages.length ? "justify-start" : "justify-center pb-8") + " flex min-h-0 flex-1 flex-col"}>
          {messages.length === 0 ? (
            <div className="mx-auto w-full max-w-[330px]">
              <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-white/6 dark:text-red-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-[28px] font-bold leading-tight tracking-normal text-neutral-950 dark:text-neutral-100">
                <span className="text-red-500 dark:text-red-400">快来和AI小助理</span>聊天吧
              </h2>
              <ul className="mt-6 space-y-4 text-[15px] text-neutral-600 dark:text-red-200/90">
                {SUGGESTIONS.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-400" />
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
                            {item.attachments.map((file) => (
                              <div
                                key={file.fileUrl}
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
          {attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((file) => (
                <div
                  key={file.fileUrl}
                  className="flex max-w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-xs text-neutral-700 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-200 dark:ring-white/10"
                  title={file.originalName}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                  <div className="min-w-0">
                    <div className="max-w-[210px] truncate font-medium">{file.originalName}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatFileSize(file.fileSize)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.fileUrl)}
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
            <textarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="开启你的灵感之旅"
              rows={2}
              className={(inputExpanded ? "min-h-[180px]" : "min-h-[64px]") + " block w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 pr-8 text-sm leading-5 text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"}
              style={{
                appearance: "none",
                WebkitAppearance: "none",
                border: "none",
                outline: "none",
                boxShadow: "none",
              }}
            />
            <button
              type="button"
              onClick={() => setInputExpanded((value) => !value)}
              className="absolute right-0 top-0 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
              title={inputExpanded ? "收起输入区" : "放大输入区"}
            >
              {inputExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 text-sm text-neutral-700 dark:text-neutral-300">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                title="上传文件"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
              <div className="relative min-w-0" ref={modelMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setModelOpen((value) => !value);
                    setHistoryOpen(false);
                  }}
                  className="inline-flex max-w-[190px] items-center gap-2 rounded-lg px-2 py-1 font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
                  title="选择模型"
                  aria-expanded={modelOpen}
                >
                  <span className="truncate">{selectedModel?.name ?? (modelsLoading ? "加载模型..." : "选择模型")}</span>
                  <ChevronDown className={(modelOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 text-neutral-500 transition-transform duration-200"} />
                </button>
                {modelOpen && (
                  <div className="absolute bottom-11 left-0 z-40 max-h-56 w-56 overflow-y-auto rounded-2xl bg-white p-1 text-sm text-neutral-800 shadow-xl ring-1 ring-neutral-200/80 dark:bg-[#25262b] dark:text-neutral-100 dark:ring-white/10">
                    {models.length ? models.map((model) => (
                      <button
                        key={model.modelId}
                        type="button"
                        onClick={() => selectModel(model)}
                        className={(model.modelId === selectedModel?.modelId ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white" : "text-neutral-700 dark:text-neutral-200") + " block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/8"}
                      >
                        <span className="block truncate font-medium leading-5">{model.name}</span>
                      </button>
                    )) : (
                      <div className="px-3 py-2 text-neutral-500 dark:text-neutral-400">暂无可用模型</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-neutral-50 px-2 pl-3 shadow-sm ring-1 ring-neutral-100 dark:bg-[#303137] dark:ring-white/8">
              <span className="flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
                <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                {pointLabel}
              </span>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={sendMessage}
                className={(canSubmit
                  ? "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  : "bg-neutral-100 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-500") + " flex h-8 w-8 items-center justify-center rounded-full transition-colors"}
                title="发送"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
