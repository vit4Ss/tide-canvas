"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import { AssistantComposer } from "./assistant/assistant-composer";
import { AssistantHistoryMenu } from "./assistant/assistant-history-menu";
import { AssistantLauncher } from "./assistant/assistant-launcher";
import { AssistantMessageList } from "./assistant/assistant-message-list";
import { AssistantPetStyleMenu } from "./assistant/assistant-pet-style-menu";
import {
  ASSISTANT_PET_STYLE_EVENT,
  ASSISTANT_PET_STYLE_STORAGE_KEY,
  fetchAssistantPetStyles,
  loadSelectedAssistantPetStyleId,
  saveSelectedAssistantPetStyleId,
} from "./assistant/pet-style";
import { resolveAssistantPetStyle } from "@/lib/assistant-pet-styles";
import {
  ASSISTANT_HANDLER,
  ASSISTANT_MODEL_STORAGE_KEY,
  CHAT_POLL_INTERVAL,
  DEFAULT_PANEL_WIDTH,
  MAX_CHAT_POLL_TIME,
  MAX_STORED_SESSIONS,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
} from "./assistant/constants";
import { parseTaskResult } from "./assistant/task-result";
import {
  createSessionId,
  loadStoredSessions,
  messageContentForHistory,
  normalizeStoredMessages,
  saveStoredSessions,
  sessionTitleFromMessages,
} from "./assistant/session-storage";
import type { AssistantChatMessage, AssistantChatRole, AssistantStoredSession } from "./assistant/types";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { referenceKindFromFile, referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { toast } from "@/components/shared/toast";
import { AiModelType, AiTaskStatus, type AiModelVO } from "@/types/ai";
import type { AssistantPetStyle } from "@/types/assistant";
import type { FileVO } from "@/types/file";

function clampPanelWidth(width: number) {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const [petStyleOpen, setPetStyleOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [resizeHover, setResizeHover] = useState(false);
  const [petStyles, setPetStyles] = useState<AssistantPetStyle[]>([]);
  const [petStylesLoading, setPetStylesLoading] = useState(false);
  const [selectedPetStyleId, setSelectedPetStyleId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSeqRef = useRef(0);
  const sessionLoadedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const petStyleMenuRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.max(56, input.scrollHeight) + "px";
  }, [message]);

  const loadPetStyles = useCallback(async () => {
    setPetStylesLoading(true);
    try {
      const styles = await fetchAssistantPetStyles();
      setPetStyles(styles);
      setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
    } catch {
      setPetStyles([]);
    } finally {
      setPetStylesLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
    loadPetStyles();
  }, [loadPetStyles]);

  useEffect(() => {
    const handlePetStyleChange = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const styleId = detail && typeof detail === "object" && "styleId" in detail ? String(detail.styleId || "") : "";
      setSelectedPetStyleId(styleId || loadSelectedAssistantPetStyleId());
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === ASSISTANT_PET_STYLE_STORAGE_KEY) setSelectedPetStyleId(loadSelectedAssistantPetStyleId());
    };
    window.addEventListener(ASSISTANT_PET_STYLE_EVENT, handlePetStyleChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener(ASSISTANT_PET_STYLE_EVENT, handlePetStyleChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  // 会话目前是画布助手的本地体验状态：恢复历史、保存当前会话都在浏览器侧完成。
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

  // 每次消息变化后重写当前会话快照，避免用户刷新页面后丢失上下文。
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
      setPetStyleOpen(false);
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
    if (!historyOpen && !modelOpen && !petStyleOpen) return;

    const handleOutsideClick = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        historyMenuRef.current?.contains(target) ||
        modelMenuRef.current?.contains(target) ||
        petStyleMenuRef.current?.contains(target)
      ) return;
      setHistoryOpen(false);
      setModelOpen(false);
      setPetStyleOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsideClick, true);
    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick, true);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [historyOpen, modelOpen, petStyleOpen]);

  // 面板宽度拖拽仍留在容器组件里，因为它直接影响 aside 的布局尺寸。
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

  const widePanel = expanded || panelWidth >= MAX_PANEL_WIDTH - 1;
  const displayWidth = widePanel ? "min(" + MAX_PANEL_WIDTH + "px, calc(100vw - 32px))" : "min(" + panelWidth + "px, calc(100vw - 32px))";
  const selectedModel = models.find((model) => model.modelId === selectedModelId) ?? models[0];
  const selectedPointCost = Number(selectedModel?.pointCost ?? 0);
  const pointLabel = selectedPointCost > 0 ? selectedPointCost.toLocaleString() : "免费";
  const defaultPetStyle = resolveAssistantPetStyle(petStyles, null);

  const togglePanelWidth = () => {
    if (widePanel) {
      setExpanded(false);
      setPanelWidth(DEFAULT_PANEL_WIDTH);
      return;
    }
    setExpanded(true);
  };

  const selectModel = (model: AiModelVO) => {
    setSelectedModelId(model.modelId);
    setModelOpen(false);
    if (typeof window !== "undefined") localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, model.modelId);
  };

  const selectPetStyle = (style: AssistantPetStyle | null) => {
    const styleId = style?.id ?? null;
    saveSelectedAssistantPetStyleId(styleId);
    setSelectedPetStyleId(styleId);
    setPetStyleOpen(false);
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

  const collapseAssistant = () => {
    setOpen(false);
    setHistoryOpen(false);
    setModelOpen(false);
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
      const validationMessage = validateKnownFileSize(file.fileSize, file.originalName, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
        label: "参考文件",
      });
      if (validationMessage) {
        toast.error(validationMessage);
        return;
      }
    }

    const nextActiveSessionId = activeSessionId || createSessionId();
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
    return <AssistantLauncher onOpen={() => setOpen(true)} />;
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
        onClick={collapseAssistant}
        className="absolute -left-7 top-14 z-30 flex h-12 w-7 items-center justify-center rounded-l-lg border border-neutral-200/70 border-r-0 bg-neutral-50 text-neutral-500 shadow-none outline-none ring-0 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-white/10 dark:bg-[#18191d] dark:text-neutral-300 dark:hover:bg-[#222329] dark:hover:text-white"
        title="收起助手"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="relative flex h-14 shrink-0 items-center justify-between gap-3 px-4 text-neutral-600 dark:text-neutral-200">
        <div className="flex min-w-0 items-center">
          <AssistantHistoryMenu
            rootRef={historyMenuRef}
            open={historyOpen}
            sessions={sessions}
            activeSessionId={activeSessionId}
            align="left"
            onOpenChange={(nextOpen) => {
              setHistoryOpen(nextOpen);
              setModelOpen(false);
              setPetStyleOpen(false);
            }}
            onStartNewSession={startNewSession}
            onSelectSession={selectSession}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <AssistantPetStyleMenu
            rootRef={petStyleMenuRef}
            open={petStyleOpen}
            styles={petStyles}
            loading={petStylesLoading}
            selectedStyleId={selectedPetStyleId}
            defaultStyle={defaultPetStyle}
            onOpenChange={(nextOpen) => {
              setPetStyleOpen(nextOpen);
              setHistoryOpen(false);
              setModelOpen(false);
            }}
            onSelect={selectPetStyle}
            onReload={loadPetStyles}
          />

          <button
            type="button"
            onClick={togglePanelWidth}
            className={(widePanel ? "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200" : "text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white") + " flex h-8 w-8 items-center justify-center rounded-lg transition-colors"}
            title={widePanel ? "恢复默认宽度" : "展开到宽屏"}
            aria-label={widePanel ? "恢复默认宽度" : "展开到宽屏"}
            aria-pressed={widePanel}
          >
            {widePanel ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={collapseAssistant}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
            title="收起助手"
            aria-label="收起助手"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4">
        <div className={(messages.length ? "justify-start" : "justify-center pb-8") + " flex min-h-0 flex-1 flex-col"}>
          <AssistantMessageList messages={messages} messagesEndRef={messagesEndRef} />
        </div>

        <AssistantComposer
          inputRef={inputRef}
          fileInputRef={fileInputRef}
          modelMenuRef={modelMenuRef}
          message={message}
          inputExpanded={inputExpanded}
          attachments={attachments}
          uploading={uploading}
          uploadProgress={uploadProgress}
          models={models}
          selectedModel={selectedModel}
          modelsLoading={modelsLoading}
          modelOpen={modelOpen}
          pointLabel={pointLabel}
          sending={sending}
          canSubmit={canSubmit}
          onMessageChange={setMessage}
          onInputKeyDown={handleInputKeyDown}
          onFileChange={handleFileChange}
          onRemoveAttachment={removeAttachment}
          onToggleInputExpanded={() => setInputExpanded((value) => !value)}
          onToggleModelOpen={() => {
            setModelOpen((value) => !value);
            setHistoryOpen(false);
            setPetStyleOpen(false);
          }}
          onSelectModel={selectModel}
          onSubmit={sendMessage}
        />
      </div>
    </aside>
  );
}
