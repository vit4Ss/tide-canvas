"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  Crop,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  Video,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
  Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { aiApi, conversationApi, fileApi, uploadFileSmart } from "@/lib/api";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskStreamEvent, type AiTaskVO } from "@/types/ai";
import { applyTeamFactor } from "@/lib/points";
import { referenceKindFromFile, referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { FileType, type FileVO } from "@/types/file";
import { toast } from "@/components/shared/toast";
import { BatchCountDropdown } from "@/components/canvas/nodes/components/batch-count-dropdown";
import { QualityRatioDropdown } from "@/components/canvas/nodes/components/quality-ratio-dropdown";
import { VideoParamControls, type VideoParamValue } from "@/components/canvas/nodes/video-param-picker";
import parameterStyles from "@/components/canvas/nodes/styles/parameter-dropdown.module.css";
import type { ImageQuality, QualityRatioValue } from "@/components/canvas/nodes/types/quality-ratio";
import { getQualityLabel, normalizeBatchOptions } from "@/components/canvas/nodes/utils/quality-ratio";
import { parseTaskResult } from "@/components/canvas/assistant/task-result";
import { CHAT_POLL_INTERVAL, MAX_CHAT_POLL_TIME } from "@/components/canvas/assistant/constants";
import { CreationMessageList } from "./creation-message-list";
import {
  calculateVideoBaseCost,
  getVideoModelOptions,
  normalizeVideoParamSelection,
  parseVideoModelConfig,
  readRememberedVideoParams,
  rememberVideoParams,
} from "@/lib/video-model-config";
import {
  notifyConversationsChanged,
  NEW_CREATION_EVENT,
  type ConversationMessageVO,
  type CreationConversationVO,
  type CreationMode,
} from "@/types/conversation";
const POLL_INTERVAL = 2000;
const MAX_POLL_IMAGE = 5 * 60 * 1000;
const MAX_POLL_VIDEO = 30 * 60 * 1000;
const MODEL_STORAGE_KEY = "tc:home:modelId";
const IMAGE_REFERENCE_LIMIT = 4;
const VIDEO_REFERENCE_LIMIT = 12;
const IMAGE_RATIO_OPTIONS = ["auto", "1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
const CREATION_TYPE_OPTIONS = [
  { id: "image", label: "图片生成", icon: ImageIcon },
  { id: "video", label: "视频生成", icon: Video },
  { id: "text", label: "文本聊天", icon: MessageSquare },
] as const;
const VIDEO_REFERENCE_MODE_OPTIONS = [
  { id: "omni", label: "全能参考", icon: Wand2 },
  { id: "firstLast", label: "首尾帧", icon: LayoutGrid },
  { id: "multiFrame", label: "智能多帧", icon: Video },
] as const;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
type ReferencePickerTab = "all" | "generated" | "uploaded";
const REFERENCE_PICKER_TABS: { id: ReferencePickerTab; label: string }[] = [
  { id: "all", label: "本地上传" },
  { id: "generated", label: "图片生成器" },
  { id: "uploaded", label: "历史上传" },
] as const;

function fileKey(file: FileVO): string {
  return file.fileUrl || String(file.id);
}

function isTemporaryFile(file: FileVO): boolean {
  return typeof file.id === "number" && file.id < 0;
}

function isImageFile(file: Pick<FileVO, "fileType" | "mimeType">): boolean {
  return file.fileType === FileType.IMAGE || file.mimeType?.startsWith("image/");
}

function isVideoFile(file: Pick<FileVO, "fileType" | "mimeType">): boolean {
  return file.fileType === FileType.VIDEO || file.mimeType?.startsWith("video/");
}

function mergeUniqueFiles(...groups: FileVO[][]): FileVO[] {
  const seen = new Set<string>();
  const merged: FileVO[] = [];
  groups.flat().forEach((file) => {
    const key = fileKey(file);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(file);
  });
  return merged;
}

function resultUrlLooksLikeVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url.split("#")[0]);
}

function taskMediaURLs(task: AiTaskVO): string[] {
  let meta: Record<string, unknown> = {};
  if (typeof task.resultMeta === "string" && task.resultMeta.trim()) {
    try {
      meta = JSON.parse(task.resultMeta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (task.resultMeta && typeof task.resultMeta === "object") {
    meta = task.resultMeta;
  }
  const urls = Array.isArray(meta.urls)
    ? meta.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  return Array.from(new Set([task.resultUrl, ...urls].filter(Boolean)));
}

function negativeIdFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

function generationTaskToFile(task: AiTaskVO): FileVO | null {
  const resultUrl = task.resultUrl?.trim();
  if (!resultUrl || resultUrlLooksLikeVideo(resultUrl)) return null;
  const taskId = String(task.id || resultUrl);
  const titleId = taskId.slice(0, 8);
  const modelName = task.modelName?.trim();
  return {
    id: negativeIdFromString(taskId),
    ownerId: undefined,
    originalName: modelName ? `${modelName} #${titleId}` : `生成图片 #${titleId || "recent"}`,
    fileUrl: resultUrl,
    fileSize: 0,
    fileType: FileType.IMAGE,
    mimeType: "image/png",
    storageType: (resultUrl.startsWith("/uploads/") ? "local" : "oss") as FileVO["storageType"],
    createTime: task.completeTime || task.createTime,
  };
}

interface ModelFormatConfig {
  pricing?: Record<string, Record<string, number>>;
  batchSizes?: number[];
}

function parseModelConfig(model?: AiModelVO): ModelFormatConfig {
  if (!model?.config) return {};
  try {
    return JSON.parse(model.config) as ModelFormatConfig;
  } catch {
    return {};
  }
}

function modelCapabilityNumber(model: AiModelVO | undefined, key: string, fallback: number): number {
  const value = model?.capabilities?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function modelAllowedMimeTypes(model: AiModelVO | undefined): string[] {
  const value = model?.capabilities?.allowedMimeTypes;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function activeBranchMessages(messages: ConversationMessageVO[], activeLeafMessageId?: string): ConversationMessageVO[] {
  if (!messages.length) return [];
  const byID = new Map(messages.map((message) => [message.id, message]));
  let current = activeLeafMessageId ? byID.get(activeLeafMessageId) : messages[messages.length - 1];
  if (!current) return messages;
  const branch: ConversationMessageVO[] = [];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    branch.push(current);
    current = current.parentMessageId ? byID.get(current.parentMessageId) : undefined;
  }
  return branch.reverse();
}

function deepestLatestDescendant(root: ConversationMessageVO, messages: ConversationMessageVO[]): ConversationMessageVO {
  let current = root;
  const visited = new Set<string>();
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const children = messages
      .filter((message) => message.parentMessageId === current.id)
      .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
    if (!children.length) break;
    current = children[0];
  }
  return current;
}

type Tab = CreationMode;
type MediaTab = Exclude<Tab, "text">;
type VideoReferenceMode = (typeof VIDEO_REFERENCE_MODE_OPTIONS)[number]["id"];

interface GenParams {
  prompt: string;
  kind: MediaTab;
  modelId: string;
  modelName: string;
  ratio: string;
  imageQuality?: ImageQuality;
  imageResolution?: string;
  imageCount?: number;
  videoResolution?: string;
  videoDuration?: number;
  videoAudio?: boolean;
  videoReferenceMode?: VideoReferenceMode;
  references?: FileVO[];
  promptReferences?: FileVO[];
  parentMessageId?: string;
}
export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initialized, isLoggedIn, user } = useAuth();
  const [tab, setTab] = useState<Tab>("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const [selectedModelId, setSelectedModelId] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("standard");
  const [imageResolution, setImageResolution] = useState("2K");
  const [imageCount, setImageCount] = useState(1);
  const [videoResolution, setVideoResolution] = useState("720P");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [referenceModeOpen, setReferenceModeOpen] = useState(false);
  const [referenceDragActive, setReferenceDragActive] = useState(false);
  const [videoReferenceMode, setVideoReferenceMode] = useState<VideoReferenceMode>("omni");
  const [references, setReferences] = useState<FileVO[]>([]);
  const [promptReferenceKeys, setPromptReferenceKeys] = useState<string[]>([]);
  const [referenceMentionOpen, setReferenceMentionOpen] = useState(false);
  const [pendingReferenceMentionRange, setPendingReferenceMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referencePickerTab, setReferencePickerTab] = useState<ReferencePickerTab>("all");
  const [referencePickerGeneratedFiles, setReferencePickerGeneratedFiles] = useState<FileVO[]>([]);
  const [referencePickerUploadedFiles, setReferencePickerUploadedFiles] = useState<FileVO[]>([]);
  const [referencePickerLocalFiles, setReferencePickerLocalFiles] = useState<FileVO[]>([]);
  const [referencePickerSelected, setReferencePickerSelected] = useState<Record<string, FileVO>>({});
  const [referencePickerNotice, setReferencePickerNotice] = useState("");
  const [referencePickerLoading, setReferencePickerLoading] = useState(false);
  const [referencePickerLoaded, setReferencePickerLoaded] = useState(false);
  const [referencePickerRefreshKey, setReferencePickerRefreshKey] = useState(0);
  const [referencePickerPreviewFile, setReferencePickerPreviewFile] = useState<FileVO | null>(null);
  const [referencePickerDeleteTarget, setReferencePickerDeleteTarget] = useState<FileVO | null>(null);
  const [referencePickerDeletingKey, setReferencePickerDeletingKey] = useState("");
  const [activeConversation, setActiveConversation] = useState<CreationConversationVO | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessageVO[]>([]);
  const [chatAttachments, setChatAttachments] = useState<FileVO[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [editingParentMessageId, setEditingParentMessageId] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ratioButtonRef = useRef<HTMLButtonElement>(null);
  const ratioPanelRef = useRef<HTMLDivElement | null>(null);
  const [ratioPanelStyle, setRatioPanelStyle] = useState<React.CSSProperties>({ left: -9999, top: -9999 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const resumedTaskIDsRef = useRef(new Set<string>());


  const updateRatioPanelPosition = useCallback(() => {
    const anchor = ratioButtonRef.current;
    if (!anchor) return;
    const gap = 10;
    const margin = 16;
    const minPanelHeight = 220;
    const anchorRect = anchor.getBoundingClientRect();
    const panelWidth = Math.min(420, Math.max(240, window.innerWidth - margin * 2));
    const measuredHeight = ratioPanelRef.current?.offsetHeight ?? (tab === "video" ? 330 : 410);
    const panelHeight = Math.min(measuredHeight, Math.max(minPanelHeight, window.innerHeight - margin * 2));
    const spaceBelow = window.innerHeight - anchorRect.bottom - gap - margin;
    const spaceAbove = anchorRect.top - gap - margin;
    const placeBelow = spaceBelow >= panelHeight || spaceBelow >= spaceAbove;
    const panelLeft = Math.min(Math.max(margin, anchorRect.left), Math.max(margin, window.innerWidth - panelWidth - margin));
    const left = panelLeft - anchorRect.left;
    const maxHeight = Math.max(160, Math.min(panelHeight, placeBelow ? spaceBelow : spaceAbove));
    setRatioPanelStyle({
      left,
      width: panelWidth,
      maxHeight,
      overflowY: "auto",
      ...(placeBelow ? { top: anchorRect.height + gap, bottom: "auto" } : { bottom: anchorRect.height + gap, top: "auto" }),
    });
  }, [tab]);

  useEffect(() => {
    if (!ratioOpen) return;
    let frame = window.requestAnimationFrame(updateRatioPanelPosition);
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateRatioPanelPosition);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [ratioOpen, updateRatioPanelPosition]);
  useEffect(() => {
    aiApi
      .listModels()
      .then((res) => {
        if (!res.success) return;
        const usable = res.data.filter(
          (m) => m.type === AiModelType.IMAGE || m.type === AiModelType.VIDEO || m.type === AiModelType.TEXT,
        );
        setModels(usable);
        const saved = typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null;
        const img = usable.find((m) => m.type === AiModelType.IMAGE);
        const restored = saved && usable.find((m) => m.modelId === saved);
        setSelectedModelId((restored ? saved : img?.modelId) ?? usable[0]?.modelId ?? "");
      })
      .catch(() => {});
  }, []);

  const requestedConversationID = searchParams.get("conversation") ?? "";

  useEffect(() => {
    if (!initialized || !isLoggedIn || !requestedConversationID) return;
    let active = true;
    setConversationLoading(true);
    conversationApi.get(requestedConversationID).then((res) => {
      if (!active) return;
      if (!res.success) {
        toast.error(res.message || "会话加载失败");
        window.history.replaceState(null, "", "/");
        return;
      }
      const conversation = res.data;
      setActiveConversation(conversation);
      setConversationMessages(conversation.messages ?? []);
      setChatAttachments([]);
      setReferences([]);
      setPrompt("");
      setPromptReferenceKeys([]);
      setTab(conversation.mode);
      const activeMessages = activeBranchMessages(conversation.messages ?? [], conversation.activeLeafMessageId);
      const lastModelID = [...activeMessages].reverse().find((message) => message.modelId)?.modelId;
      if (lastModelID) setSelectedModelId(lastModelID);
    }).finally(() => {
      if (active) setConversationLoading(false);
    });
    return () => { active = false; };
  }, [initialized, isLoggedIn, requestedConversationID]);

  const ensureConversation = async (mode: CreationMode): Promise<CreationConversationVO | null> => {
    if (activeConversation?.mode === mode) return activeConversation;
    const res = await conversationApi.create(mode);
    if (!res.success) {
      toast.error(res.message || "新建会话失败");
      return null;
    }
    const conversation = res.data;
    setActiveConversation(conversation);
    setConversationMessages([]);
    window.history.pushState(null, "", `/?conversation=${encodeURIComponent(conversation.id)}`);
    notifyConversationsChanged();
    return conversation;
  };
  useEffect(() => {
    if (!initialized || !isLoggedIn) {
      queueMicrotask(() => setHandlerCosts({}));
      return;
    }

    let active = true;
    aiApi.listHandlers().then((res) => {
      if (!active || !res.success) return;
      const costs: Record<string, number> = {};
      res.data.forEach((handler) => {
        if (handler.handlerName) costs[handler.handlerName] = handler.pointCost ?? 0;
      });
      setHandlerCosts(costs);
    }).catch(() => {});
    return () => { active = false; };
  }, [initialized, isLoggedIn]);

  useEffect(() => {
    if (!referencePickerOpen || !isLoggedIn) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setReferencePickerLoading(true);
      setReferencePickerLoaded(false);
    });
    Promise.all([
      fileApi.list({ pageNum: 1, pageSize: 80, fileType: FileType.IMAGE }),
      aiApi.listTasks({ pageNum: 1, pageSize: 80, status: AiTaskStatus.SUCCESS }),
    ]).then(([fileRes, taskRes]) => {
      if (!active) return;
      if (fileRes.success) {
        setReferencePickerUploadedFiles(fileRes.data.records.filter(isImageFile));
      }
      if (taskRes.success) {
        const generated = taskRes.data.records
          .map(generationTaskToFile)
          .filter((file): file is FileVO => Boolean(file));
        setReferencePickerGeneratedFiles(mergeUniqueFiles(generated));
      }
    }).catch(() => {
      if (active) toast.error("参考图片加载失败，请稍后重试");
    }).finally(() => {
      if (!active) return;
      setReferencePickerLoading(false);
      setReferencePickerLoaded(true);
    });
    return () => { active = false; };
  }, [referencePickerOpen, referencePickerRefreshKey, isLoggedIn]);

  const tabModels = models.filter((m) => {
    if (tab === "video") return m.type === AiModelType.VIDEO;
    if (tab === "text") return m.type === AiModelType.TEXT;
    return m.type === AiModelType.IMAGE;
  });
  const selectedModel = tabModels.find((m) => m.modelId === selectedModelId) ?? tabModels[0];
  const selectedVideoConfig = parseVideoModelConfig(selectedModel?.config);
  const selectedVideoOptions = getVideoModelOptions(selectedVideoConfig);
  const effectiveVideoParam = normalizeVideoParamSelection(selectedVideoConfig, {
    ratio,
    resolution: videoResolution,
    duration: videoDuration,
    audio: videoAudio,
  });
  const ratioOptions = tab === "video" ? selectedVideoOptions.ratios : IMAGE_RATIO_OPTIONS;
  const defaultRatio = tab === "video" ? effectiveVideoParam.ratio : "1:1";
  const effectiveRatio = ratioOptions.includes(ratio) ? ratio : defaultRatio;
  const ratioForRequest = effectiveRatio === "auto" ? "" : effectiveRatio;
  const referenceLimit = tab === "text"
    ? Math.min(10, modelCapabilityNumber(selectedModel, "maxInputFiles", 10))
    : tab === "video"
      ? modelCapabilityNumber(selectedModel, "maxReferenceFiles", VIDEO_REFERENCE_LIMIT)
      : modelCapabilityNumber(selectedModel, "maxReferenceImages", IMAGE_REFERENCE_LIMIT);
  const activeAttachments = tab === "text" ? chatAttachments : references;
  const canUploadReferences = !uploading && activeAttachments.length < referenceLimit;
  const promptReferenceFiles = promptReferenceKeys
    .map((key) => references.find((file) => fileKey(file) === key))
    .filter((file): file is FileVO => Boolean(file));
  const promptReferenceKeySet = new Set(promptReferenceKeys);
  const referencePickerSelectedFiles = Object.values(referencePickerSelected);
  const referencePickerDisplayFiles = referencePickerTab === "generated"
    ? referencePickerGeneratedFiles
    : referencePickerTab === "uploaded"
      ? referencePickerUploadedFiles
      : mergeUniqueFiles(referencePickerLocalFiles, referencePickerGeneratedFiles, referencePickerUploadedFiles);
  const referencePickerSelectedTotal = referencePickerSelectedFiles.length;
  const composerPlaceholder = tab === "text"
    ? (chatAttachments.length ? "围绕附件内容提问，或继续当前对话" : "输入消息，开始与 AI 对话")
    : references.length
    ? (tab === "video"
        ? "输入 @ 引用参考素材，描述你想生成的视频"
        : "输入 @ 引用参考图，描述你想生成的图片")
    : (tab === "video"
        ? "输入视频生成的提示词，例如：电影感雨夜街头，镜头缓慢推进"
        : "输入图片生成的提示词，例如：浩瀚的银河中一艘宇宙飞船驶过");
  const uploadLabel = tab === "text" ? "附件" : tab === "video" ? "参考内容" : "参考图";
  const referenceMode = VIDEO_REFERENCE_MODE_OPTIONS.find((item) => item.id === videoReferenceMode) ?? VIDEO_REFERENCE_MODE_OPTIONS[0];
  const referenceModeLabel = references.length ? referenceMode.label + " " + references.length : referenceMode.label;
  const modelLabel = selectedModel?.name ?? "暂无可用模型";
  const ReferenceModeIcon = referenceMode.icon;
  const modelSelectable = tabModels.length > 0;
  const visibleConversationMessages = activeBranchMessages(
    conversationMessages,
    activeConversation?.activeLeafMessageId,
  );
  const hasConversationContent = visibleConversationMessages.length > 0;
  const busy = conversationMessages.some(
    (message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"),
  );
  const hasPromptContent = Boolean(prompt.trim() || (tab === "text" ? chatAttachments.length : promptReferenceFiles.length));
  const canSubmit = hasPromptContent && !busy && !uploading;
  const selectedModelConfig = parseModelConfig(selectedModel);
  const safeImageCountOptions = normalizeBatchOptions(selectedModelConfig.batchSizes);
  const effectiveImageCount = safeImageCountOptions.includes(imageCount) ? imageCount : safeImageCountOptions[0] ?? 1;
  const imageMatrixCost = tab === "image" ? selectedModelConfig.pricing?.[imageQuality]?.[imageResolution] : undefined;
  const videoBaseCost = tab === "video" ? calculateVideoBaseCost(selectedVideoConfig, effectiveVideoParam) : undefined;
  const paramSummary = tab === "image"
    ? [
        effectiveRatio === "auto" ? "自动" : effectiveRatio,
        getQualityLabel(imageQuality),
        imageResolution,
      ].join(" · ")
    : [
        effectiveRatio === "auto" ? "自动" : effectiveRatio,
        effectiveVideoParam.resolution,
        `${effectiveVideoParam.duration}s`,
      ].join(" · ");
  const imageParamValue: QualityRatioValue = { ratio: effectiveRatio, quality: imageQuality, clarity: imageResolution };
  const imageRefCount = references.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).length;
  const videoRefCount = references.filter((file) => file.fileType === "video" || file.mimeType?.startsWith("video/")).length;
  const handlerForCost = tab === "text"
    ? "assistant_chat"
    : tab === "image"
    ? (imageRefCount > 0 ? "image_to_image" : "text_to_image")
    : (imageRefCount > 0 && videoReferenceMode === "firstLast"
        ? "start_end_to_video"
        : (imageRefCount > 0 || videoRefCount > 0 ? "reference_to_video" : "text_to_video"));
  const modelPointCost = selectedModel && selectedModel.pointCost > 0 ? selectedModel.pointCost : undefined;
  const handlerPointCost = handlerCosts[handlerForCost] && handlerCosts[handlerForCost] > 0 ? handlerCosts[handlerForCost] : undefined;
  const basePointCost = tab === "video"
    ? videoBaseCost ?? 0
    : imageMatrixCost ?? modelPointCost ?? handlerPointCost ?? (tab === "image" ? 18 : 0);
  const displayPointCost = applyTeamFactor(basePointCost * (tab === "image" ? effectiveImageCount : 1), user);

  useEffect(() => {
    if (tab !== "video" || !selectedModel?.modelId) return;
    const next = normalizeVideoParamSelection(
      parseVideoModelConfig(selectedModel.config),
      readRememberedVideoParams(selectedModel.modelId),
    );
    setRatio(next.ratio);
    setVideoResolution(next.resolution);
    setVideoDuration(next.duration);
    setVideoAudio(next.audio);
  }, [selectedModel?.config, selectedModel?.modelId, tab]);

  const updateVideoParam = (next: VideoParamValue) => {
    const normalized = normalizeVideoParamSelection(selectedVideoConfig, next);
    setRatio(normalized.ratio);
    setVideoResolution(normalized.resolution);
    setVideoDuration(normalized.duration);
    setVideoAudio(normalized.audio);
    if (selectedModel?.modelId) rememberVideoParams(selectedModel.modelId, normalized);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleConversationMessages.length]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = hasConversationContent ? 168 : 228;
    el.style.height = "auto";
    const nextHeight = Math.min(maxHeight, Math.max(86, el.scrollHeight));
    el.style.height = nextHeight + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, promptReferenceKeys.length, chatAttachments.length, hasConversationContent]);
  const getReferenceMention = (file: FileVO, index: number) => {
    const isVideoRef = file.fileType === "video" || file.mimeType?.startsWith("video/");
    return `@${isVideoRef ? "视频" : "图片"}${index + 1}`;
  };


  const addPromptReference = (file: FileVO) => {
    const key = fileKey(file);
    const mentionRange = pendingReferenceMentionRange;
    setPromptReferenceKeys((current) => (current.includes(key) ? current : [...current, key]));
    if (mentionRange) {
      setPrompt((current) => {
        const start = Math.max(0, Math.min(mentionRange.start, current.length));
        const end = Math.max(start, Math.min(mentionRange.end, current.length));
        return current.slice(0, start) + current.slice(end);
      });
    }
    setPendingReferenceMentionRange(null);
    setReferenceMentionOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const removePromptReference = (file: FileVO) => {
    const key = fileKey(file);
    setPromptReferenceKeys((current) => current.filter((item) => item !== key));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const openReferenceMentionFromText = (textarea: HTMLTextAreaElement) => {
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const directAtIndex = value[selectionStart] === "@" ? selectionStart : -1;
    const beforeAtIndex = selectionStart > 0 && value[selectionStart - 1] === "@" ? selectionStart - 1 : -1;
    const previousAtIndex = value.lastIndexOf("@", Math.max(0, selectionStart));
    const atIndex = [directAtIndex, beforeAtIndex, previousAtIndex].find((index) => {
      if (index < 0) return false;
      return !/\s/.test(value.slice(index + 1, selectionStart));
    });
    if (atIndex === undefined || atIndex < 0) return false;
    let end = Math.max(selectionEnd, atIndex + 1);
    while (end < value.length && !/\s/.test(value[end])) end += 1;
    setPendingReferenceMentionRange({ start: atIndex, end });
    if (references.length) {
      setReferenceMentionOpen(true);
    } else {
      openReferencePicker();
    }
    return true;
  };

  const handlePromptDoubleClick = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    if (openReferenceMentionFromText(event.currentTarget)) {
      event.preventDefault();
    }
  };
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setRatio(next === "video" ? "16:9" : "1:1");
    setTypeOpen(false);
    setRatioOpen(false);
    setCountOpen(false);
    setReferenceModeOpen(false);
    setActiveConversation(null);
    setConversationMessages([]);
    setPrompt("");
    setPromptReferenceKeys([]);
    setReferences([]);
    setChatAttachments([]);
    setEditingParentMessageId(undefined);
    window.history.pushState(null, "", "/");
    const list = models.filter((m) =>
      next === "video" ? m.type === AiModelType.VIDEO : next === "text" ? m.type === AiModelType.TEXT : m.type === AiModelType.IMAGE,
    );
    if (list[0]) setSelectedModelId(list[0].modelId);
  };

  const resetToBlankImage = useCallback(() => {
    setTab("image");
    setRatio("1:1");
    setActiveConversation(null);
    setConversationMessages([]);
    setPrompt("");
    setPromptReferenceKeys([]);
    setReferences([]);
    setChatAttachments([]);
    setEditingParentMessageId(undefined);
    setTypeOpen(false);
    setModelOpen(false);
    setRatioOpen(false);
    setCountOpen(false);
    setReferenceModeOpen(false);
    const firstImageModel = models.find((model) => model.type === AiModelType.IMAGE);
    if (firstImageModel) setSelectedModelId(firstImageModel.modelId);
    window.history.replaceState(null, "", "/");
  }, [models]);

  useEffect(() => {
    window.addEventListener(NEW_CREATION_EVENT, resetToBlankImage);
    return () => window.removeEventListener(NEW_CREATION_EVENT, resetToBlankImage);
  }, [resetToBlankImage]);

  const selectCreationType = (id: (typeof CREATION_TYPE_OPTIONS)[number]["id"]) => {
    if (id === "image" || id === "video" || id === "text") {
      switchTab(id);
      setTypeOpen(false);
      return;
    }
  };

  const selectModel = (id: string) => {
    setSelectedModelId(id);
    setModelOpen(false);
    setCountOpen(false);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  };

  const patchConversationMessage = (messageID: string, data: Partial<ConversationMessageVO>) => {
    setConversationMessages((current) => current.map((message) => message.id === messageID ? { ...message, ...data } : message));
  };

  const persistConversationMessagePatch = async (
    conversationID: string,
    messageID: string,
    data: Parameters<typeof conversationApi.updateMessage>[2],
  ) => {
    patchConversationMessage(messageID, data as Partial<ConversationMessageVO>);
    const res = await conversationApi.updateMessage(conversationID, messageID, data);
    if (res.success) {
      patchConversationMessage(messageID, res.data);
      notifyConversationsChanged();
    }
  };

  const pollTextTask = async (conversationID: string, messageID: string, taskID: string) => {
    const deadline = Date.now() + MAX_CHAT_POLL_TIME;
    while (Date.now() < deadline) {
      await wait(CHAT_POLL_INTERVAL);
      const res = await aiApi.getTask(taskID);
      if (!res.success) {
        await persistConversationMessagePatch(conversationID, messageID, { status: "error", content: res.message || "获取回复失败" });
        return;
      }
      const task = res.data;
      if (task.status === AiTaskStatus.SUCCESS) {
        await persistConversationMessagePatch(conversationID, messageID, { status: "done", content: parseTaskResult(task), taskId: String(task.id) });
        return;
      }
      if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
        await persistConversationMessagePatch(conversationID, messageID, { status: task.status === AiTaskStatus.CANCELLED ? "cancelled" : "error", content: task.errorMsg || "生成失败", taskId: String(task.id) });
        return;
      }
    }
    await persistConversationMessagePatch(conversationID, messageID, { status: "error", content: "回复超时，请稍后重试。" });
  };

  const streamTextTask = async (conversationID: string, messageID: string, taskID: string) => {
    let streamedContent = "";
    try {
      await aiApi.streamTask(taskID, (event: AiTaskStreamEvent) => {
        if (event.content) streamedContent = event.content;
        patchConversationMessage(messageID, {
          status: event.status === AiTaskStatus.PROCESSING ? "streaming"
            : event.status === AiTaskStatus.SUCCESS ? "done"
              : event.status === AiTaskStatus.CANCELLED ? "cancelled" : "error",
          content: event.content || (event.error ? event.error : "正在思考..."),
          taskId: String(event.taskId || taskID),
        });
      });
    } catch {
      await pollTextTask(conversationID, messageID, taskID);
      return;
    }
    const final = await aiApi.getTask(taskID);
    if (!final.success) {
      await persistConversationMessagePatch(conversationID, messageID, {
        status: "error",
        content: final.message || "获取回复失败",
      });
      return;
    }
    const task = final.data;
    if (task.status === AiTaskStatus.SUCCESS) {
      await persistConversationMessagePatch(conversationID, messageID, {
        status: "done",
        content: streamedContent || parseTaskResult(task),
        taskId: String(task.id),
      });
    } else {
      await persistConversationMessagePatch(conversationID, messageID, {
        status: task.status === AiTaskStatus.CANCELLED ? "cancelled" : "error",
        content: task.errorMsg || (task.status === AiTaskStatus.CANCELLED ? "已停止生成，扣除的积分已退回。" : "生成失败"),
        taskId: String(task.id),
      });
    }
  };

  const completeMediaMessage = async (
    conversationID: string,
    messageID: string,
    task: AiTaskVO,
    metadata: Record<string, unknown>,
  ) => {
    if (task.status === AiTaskStatus.SUCCESS) {
      const urls = taskMediaURLs(task);
      await persistConversationMessagePatch(conversationID, messageID, {
        status: "done",
        taskId: String(task.id),
        content: "",
        metadata: { ...metadata, url: urls[0] ?? task.resultUrl, urls, resultMeta: task.resultMeta, progress: 100 },
      });
      return true;
    }
    if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
      await persistConversationMessagePatch(conversationID, messageID, {
        status: task.status === AiTaskStatus.CANCELLED ? "cancelled" : "error",
        taskId: String(task.id),
        content: task.errorMsg || t("genFailed"),
        metadata: { ...metadata, progress: task.progress },
      });
      return true;
    }
    await persistConversationMessagePatch(conversationID, messageID, {
      status: "streaming",
      taskId: String(task.id),
      metadata: { ...metadata, progress: task.progress },
    });
    return false;
  };

  const pollMediaTask = async (
    conversationID: string,
    messageID: string,
    taskID: string,
    maxPoll: number,
    metadata: Record<string, unknown>,
  ) => {
    const deadline = Date.now() + maxPoll;
    while (Date.now() < deadline) {
      await wait(POLL_INTERVAL);
      try {
        const res = await aiApi.getTask(taskID);
        if (!res.success) {
          await persistConversationMessagePatch(conversationID, messageID, {
            status: "error",
            content: res.message || t("genFailed"),
            metadata,
          });
          return;
        }
        if (await completeMediaMessage(conversationID, messageID, res.data, metadata)) return;
      } catch (error) {
        await persistConversationMessagePatch(conversationID, messageID, {
          status: "error",
          content: (error as Error)?.message || t("genFailed"),
          metadata,
        });
        return;
      }
    }
    await aiApi.cancelTask(taskID).catch(() => undefined);
    await persistConversationMessagePatch(conversationID, messageID, {
      status: "error",
      content: t("genTimeout"),
      metadata,
    });
  };

  const resumeTextTask = useEffectEvent(streamTextTask);
  const resumeMediaTask = useEffectEvent(pollMediaTask);

  useEffect(() => {
    if (!activeConversation) return;
    conversationMessages.forEach((message) => {
      if (message.role !== "assistant" || !message.taskId) return;
      if (message.status !== "pending" && message.status !== "streaming") return;
      const taskID = String(message.taskId);
      if (resumedTaskIDsRef.current.has(taskID)) return;
      resumedTaskIDsRef.current.add(taskID);
      const resume = message.contentType === "text"
        ? resumeTextTask(activeConversation.id, message.id, taskID)
        : resumeMediaTask(
            activeConversation.id,
            message.id,
            taskID,
            message.contentType === "video" ? MAX_POLL_VIDEO : MAX_POLL_IMAGE,
            message.metadata ?? {},
          );
      void resume.finally(() => resumedTaskIDsRef.current.delete(taskID));
    });
  }, [activeConversation, conversationMessages]);

  const sendTextMessage = async (override?: {
    content: string;
    attachments?: FileVO[];
    parentMessageId?: string;
  }) => {
    const text = (override?.content ?? prompt).trim();
    const attachments = override?.attachments ?? chatAttachments;
    if ((!text && attachments.length === 0) || busy || uploading) return;
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (!selectedModel) {
      toast.info("请先在后台配置可用文本模型");
      return;
    }

    const conversation = await ensureConversation("text");
    if (!conversation) return;
    const parentMessageID = override
      ? override.parentMessageId
      : editingParentMessageId ?? activeConversation?.activeLeafMessageId;
    const historyBranch = parentMessageID ? activeBranchMessages(conversationMessages, parentMessageID) : [];
    const historyMessages = historyBranch
      .filter((message) => message.status === "done" && (message.role === "user" || message.role === "assistant"))
      .map((message) => ({ role: message.role, content: message.content }));
    const contextAttachments = mergeUniqueFiles(
      ...historyBranch
        .filter((message) => message.role === "user")
        .map((message) => filesFromMessage(message)),
      attachments,
    );
    const currentAttachmentKeys = new Set(attachments.map(fileKey));
    const userContent = text || "请分析这些附件";
    const userRes = await conversationApi.appendMessage(conversation.id, {
      parentMessageId: parentMessageID,
      role: "user",
      contentType: "text",
      content: userContent,
      status: "done",
      files: attachments.map((file) => ({ fileId: String(file.id), relation: "attachment" })),
    });
    if (!userRes.success) {
      toast.error(userRes.message || "发送失败");
      return;
    }
    const userMessage = userRes.data;
    const assistantRes = await conversationApi.appendMessage(conversation.id, {
      parentMessageId: userMessage.id,
      role: "assistant",
      contentType: "text",
      content: "正在思考...",
      modelId: selectedModel.modelId,
      modelName: selectedModel.name,
      status: "pending",
    });
    if (!assistantRes.success) {
      toast.error(assistantRes.message || "发送失败");
      return;
    }
    const assistantMessage = assistantRes.data;
    setConversationMessages((current) => [...current, userMessage, assistantMessage]);
    setActiveConversation((current) => current ? { ...current, activeLeafMessageId: assistantMessage.id } : conversation);
    setPrompt("");
    setChatAttachments([]);
    setEditingParentMessageId(undefined);
    notifyConversationsChanged();

    try {
      const res = await aiApi.generate({
        handler: "assistant_chat",
        modelId: selectedModel.modelId,
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        input: {
          prompt: userContent,
          messages: historyMessages,
          attachments: contextAttachments.map((file) => ({
            name: file.originalName,
            url: file.fileUrl,
            type: file.fileType,
            mimeType: file.mimeType,
            size: file.fileSize,
            current: currentAttachmentKeys.has(fileKey(file)),
          })),
          currentAttachmentCount: attachments.length,
        },
      });
      if (!res.success) {
        await persistConversationMessagePatch(conversation.id, assistantMessage.id, { status: "error", content: res.message || "发送失败" });
        return;
      }
      const task = res.data;
      await persistConversationMessagePatch(conversation.id, assistantMessage.id, { taskId: String(task.id), status: task.status === AiTaskStatus.SUCCESS ? "done" : "streaming" });
      if (task.status === AiTaskStatus.SUCCESS) {
        await persistConversationMessagePatch(conversation.id, assistantMessage.id, { status: "done", content: parseTaskResult(task), taskId: String(task.id) });
      } else if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
        await persistConversationMessagePatch(conversation.id, assistantMessage.id, { status: task.status === AiTaskStatus.CANCELLED ? "cancelled" : "error", content: task.errorMsg || "生成失败", taskId: String(task.id) });
      } else {
        const taskID = String(task.id);
        resumedTaskIDsRef.current.add(taskID);
        try {
          await streamTextTask(conversation.id, assistantMessage.id, taskID);
        } finally {
          resumedTaskIDsRef.current.delete(taskID);
        }
      }
    } catch (error) {
      await persistConversationMessagePatch(conversation.id, assistantMessage.id, { status: "error", content: (error as Error)?.message || "发送失败" });
    }
  };

  const doGenerate = async (p: GenParams) => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (!p.modelId) {
      toast.info("请先在后台配置可用模型");
      return;
    }
    const refs = p.references ?? [];
    const promptRefs = p.promptReferences ?? [];
    const referenceText = promptRefs.length
      ? promptRefs.map((file) => {
          const referenceIndex = refs.findIndex((item) => fileKey(item) === fileKey(file));
          return getReferenceMention(file, referenceIndex >= 0 ? referenceIndex : 0);
        }).join(" ") + " "
      : "";
    const text = (referenceText + p.prompt).trim();
    if (!text) return;
    const modelForRequest = models.find((model) => model.modelId === p.modelId);
    for (const file of refs) {
      const kind = referenceKindFromMeta(file);
      const message = validateKnownFileSize(file.fileSize, file.originalName, {
        maxBytes: resolveModelReferenceLimitBytes(modelForRequest, kind),
        label: "参考文件",
      });
      if (message) { toast.error(message); return; }
    }
    const imageUrls = refs.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).map((file) => file.fileUrl).filter(Boolean);
    const videoUrls = refs.filter((file) => file.fileType === "video" || file.mimeType?.startsWith("video/")).map((file) => file.fileUrl).filter(Boolean);
    const mediaParams = p.kind === "video"
      ? {
          ...(p.videoResolution ? { resolution: p.videoResolution.toLowerCase() } : {}),
          ...(p.videoDuration ? { duration: p.videoDuration } : {}),
          generateAudio: Boolean(p.videoAudio),
        }
      : {
          ...(p.imageQuality ? { quality: p.imageQuality } : {}),
          ...(p.imageResolution ? { resolution: p.imageResolution.toLowerCase() } : {}),
          ...(p.imageCount && p.imageCount > 1 ? { batchCount: p.imageCount } : {}),
        };
    let handler = imageUrls.length ? "image_to_image" : "text_to_image";
    let referenceInput: Record<string, unknown> = imageUrls.length
      ? { imageList: imageUrls, sourceImage: imageUrls[0], references: imageUrls.slice(1) }
      : {};
    if (p.kind === "video") {
      handler = imageUrls.length || videoUrls.length ? "reference_to_video" : "text_to_video";
      referenceInput = {
        ...(imageUrls.length ? { references: imageUrls } : {}),
        ...(videoUrls.length ? { videoReferences: videoUrls } : {}),
      };
      if (imageUrls.length && p.videoReferenceMode === "firstLast") {
        handler = "start_end_to_video";
        referenceInput = { firstFrame: imageUrls[0], lastFrame: imageUrls[1] ?? imageUrls[0] };
      } else if (imageUrls.length && p.videoReferenceMode === "multiFrame") {
        handler = "reference_to_video";
        referenceInput = { references: imageUrls };
      }
    }

    const conversation = await ensureConversation(p.kind);
    if (!conversation) return;
    const parentMessageID = p.parentMessageId ?? (activeConversation?.mode === p.kind
      ? activeConversation.activeLeafMessageId
      : undefined);
    const userRes = await conversationApi.appendMessage(conversation.id, {
      parentMessageId: parentMessageID,
      role: "user",
      contentType: "text",
      content: text,
      status: "done",
      files: refs
        .filter((file) => !(typeof file.id === "number" && file.id < 0))
        .map((file) => ({ fileId: String(file.id), relation: "reference" as const })),
    });
    if (!userRes.success) {
      toast.error(userRes.message || "发送失败");
      return;
    }
    const metadata: Record<string, unknown> = {
      kind: p.kind,
      prompt: text,
      ratio: p.ratio,
      handler,
      params: mediaParams,
      referenceMode: p.videoReferenceMode,
      referenceUrls: refs.map((file) => file.fileUrl).filter(Boolean),
      progress: 0,
    };
    const assistantRes = await conversationApi.appendMessage(conversation.id, {
      parentMessageId: userRes.data.id,
      role: "assistant",
      contentType: p.kind,
      content: p.kind === "video" ? "正在生成视频..." : "正在生成图片...",
      modelId: p.modelId,
      modelName: p.modelName,
      status: "pending",
      metadata,
    });
    if (!assistantRes.success) {
      toast.error(assistantRes.message || "发送失败");
      return;
    }
    const assistantMessage = assistantRes.data;
    setConversationMessages((current) => [...current, userRes.data, assistantMessage]);
    setActiveConversation({ ...conversation, activeLeafMessageId: assistantMessage.id });
    notifyConversationsChanged();

    try {
      const res = await aiApi.generate({
        handler,
        modelId: p.modelId,
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        input: {
          prompt: text,
          ...(p.ratio ? { aspectRatio: p.ratio, aspect_ratio: p.ratio, ratio: p.ratio } : {}),
          ...mediaParams,
          ...referenceInput,
        },
      });
      if (!res.success) {
        await persistConversationMessagePatch(conversation.id, assistantMessage.id, {
          status: "error",
          content: res.message || t("genFailed"),
          metadata,
        });
        return;
      }
      if (await completeMediaMessage(conversation.id, assistantMessage.id, res.data, metadata)) return;
      const taskID = String(res.data.id);
      resumedTaskIDsRef.current.add(taskID);
      try {
        await pollMediaTask(
          conversation.id,
          assistantMessage.id,
          taskID,
          p.kind === "video" ? MAX_POLL_VIDEO : MAX_POLL_IMAGE,
          metadata,
        );
      } finally {
        resumedTaskIDsRef.current.delete(taskID);
      }
    } catch (error) {
      await persistConversationMessagePatch(conversation.id, assistantMessage.id, {
        status: "error",
        content: (error as Error)?.message || t("genFailed"),
        metadata,
      });
    }
  };
  const submit = () => {
    if (!hasPromptContent || busy || uploading) return;
    if (tab === "text") {
      void sendTextMessage();
      return;
    }
    doGenerate({
      prompt,
      kind: tab,
      modelId: selectedModel?.modelId ?? "",
      modelName: selectedModel?.name ?? "",
      ratio: ratioForRequest,
      imageQuality,
      imageResolution,
      imageCount: effectiveImageCount,
      videoResolution: effectiveVideoParam.resolution,
      videoDuration: effectiveVideoParam.duration,
      videoAudio: effectiveVideoParam.audio,
      videoReferenceMode,
      references,
      promptReferences: promptReferenceFiles,
      parentMessageId: editingParentMessageId,
    });
    setPrompt("");
    setPromptReferenceKeys([]);
    setReferenceMentionOpen(false);
    setEditingParentMessageId(undefined);
  };

  const openReferencePicker = () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (!canUploadReferences) {
      toast.error(tab === "text" ? `每条消息最多上传 ${referenceLimit} 个附件` : tab === "video" ? `最多上传 ${referenceLimit} 个参考素材` : `图片生成最多上传 ${referenceLimit} 张参考图`);
      return;
    }
    if (tab === "text") {
      fileInputRef.current?.click();
      return;
    }
    setReferencePickerSelected({});
    setReferencePickerNotice("");
    setReferencePickerTab("all");
    setReferencePickerOpen(true);
  };

  const toggleReferencePickerFile = (file: FileVO) => {
    const key = fileKey(file);
    if (references.some((item) => fileKey(item) === key)) {
      setReferencePickerNotice("该参考素材已添加");
      return;
    }
    const selectedCount = Object.keys(referencePickerSelected).length;
    const maxSelectable = Math.max(0, referenceLimit - references.length);
    if (!referencePickerSelected[key] && selectedCount >= maxSelectable) {
      setReferencePickerNotice(tab === "video" ? `最多选择 ${VIDEO_REFERENCE_LIMIT} 个参考素材` : `最多选择 ${IMAGE_REFERENCE_LIMIT} 张参考图`);
      return;
    }
    setReferencePickerNotice("");
    setReferencePickerSelected((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: file };
    });
  };

  const confirmReferencePicker = () => {
    const picked = Object.values(referencePickerSelected);
    if (picked.length) {
      setReferences((current) => mergeUniqueFiles(current, picked).slice(0, referenceLimit));
    }
    setReferencePickerSelected({});
    setReferencePickerNotice("");
    setReferencePickerOpen(false);
  };
  const uploadReferenceFiles = async (picked: File[], target: "references" | "picker" = "references") => {
    if (!picked.length) return;
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const accepted = picked.filter((file) => {
      const configuredTypes = modelAllowedMimeTypes(selectedModel);
      if (configuredTypes.length) {
        const mime = file.type || "application/octet-stream";
        if (!configuredTypes.some((allowed) => allowed === mime || (allowed.endsWith("/*") && mime.startsWith(allowed.slice(0, -1))))) return false;
      }
      if (tab === "text") {
        if (configuredTypes.length) return true;
        return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|csv)$/i.test(file.name) || file.type.startsWith("image/") || file.type.startsWith("text/");
      }
      if (tab === "image") return file.type.startsWith("image/");
      return file.type.startsWith("image/") || file.type.startsWith("video/");
    });
    if (!accepted.length) {
      toast.error(tab === "text" ? "请选择图片、PDF、Office、文本、Markdown 或 CSV 文件" : tab === "image" ? "请拖入图片文件" : "请拖入图片或视频文件");
      return;
    }
    if (accepted.length < picked.length) {
      toast.info(tab === "image" ? "已忽略非图片文件" : "已忽略不支持的文件类型");
    }
    const maxReferences = referenceLimit;
    const maxVideoReferences = modelCapabilityNumber(selectedModel, "maxReferenceVideos", VIDEO_REFERENCE_LIMIT);
    const maxImageReferences = modelCapabilityNumber(selectedModel, "maxReferenceImages", referenceLimit);
    let remainingVideos = Math.max(0, maxVideoReferences - activeAttachments.filter(isVideoFile).length);
    let remainingImages = Math.max(0, maxImageReferences - activeAttachments.filter(isImageFile).length);
    const typeLimited = tab === "video" ? accepted.filter((file) => {
      if (file.type.startsWith("video/")) {
        if (remainingVideos <= 0) return false;
        remainingVideos -= 1;
        return true;
      }
      if (file.type.startsWith("image/")) {
        if (remainingImages <= 0) return false;
        remainingImages -= 1;
      }
      return true;
    }) : accepted;
    const selectedInPicker = target === "picker" ? Object.keys(referencePickerSelected).length : 0;
    const usedReferences = activeAttachments.length + selectedInPicker;
    const available = Math.max(0, maxReferences - usedReferences);
    const files = typeLimited.slice(0, available);
    if (!files.length) {
      toast.error(tab === "text" ? `每条消息最多上传 ${maxReferences} 个附件` : tab === "video" ? `最多上传 ${maxReferences} 个参考素材` : `图片生成最多上传 ${maxReferences} 张参考图`);
      return;
    }
    if (typeLimited.length < accepted.length) {
      toast.info("部分文件已达到当前模型的分类参考数量上限");
    } else if (accepted.length > available) {
      toast.info(tab === "text" ? `最多保留 ${maxReferences} 个附件，已选择前 ${available} 个` : tab === "video" ? `最多保留 ${maxReferences} 个参考素材，已选择前 ${available} 个` : `图片生成最多保留 ${maxReferences} 张参考图`);
    }
    setUploading(true);
    setUploadProgress(0);
    const uploaded: FileVO[] = [];
    for (const file of files) {
      try {
        const kind = referenceKindFromFile(file);
        const result = await uploadFileSmart(file, (progress) => setUploadProgress(progress), {
          maxBytes: tab === "text"
            ? Math.min(20, modelCapabilityNumber(selectedModel, "maxFileSizeMB", 20)) * 1024 * 1024
            : resolveModelReferenceLimitBytes(selectedModel, kind),
          label: tab === "text" ? "附件" : kind === "video" ? "参考视频" : "参考图",
          purpose: tab === "text" ? "conversation" : "asset",
        });
        if (result.success && result.data?.fileUrl) {
          uploaded.push(result.data);
        } else {
          toast.error(result.message || "上传失败：" + file.name);
        }
      } catch (error) {
        toast.error("上传失败：" + ((error as Error)?.message || file.name));
      }
    }
    if (uploaded.length) {
      if (tab === "text") {
        setChatAttachments((current) => mergeUniqueFiles(current, uploaded).slice(0, maxReferences));
      } else if (target === "picker") {
        setReferencePickerLocalFiles((current) => mergeUniqueFiles(uploaded, current));
        setReferencePickerSelected((current) => {
          const next = { ...current };
          const existingReferences = new Set(references.map(fileKey));
          uploaded.forEach((file) => {
            const key = fileKey(file);
            if (!existingReferences.has(key) && Object.keys(next).length < maxReferences - references.length) {
              next[key] = file;
            }
          });
          return next;
        });
        setReferencePickerTab("all");
      } else {
        setReferences((current) => mergeUniqueFiles(current, uploaded).slice(0, maxReferences));
      }
      toast.success(uploaded.length > 1 ? `已上传 ${uploaded.length} 个${tab === "text" ? "附件" : "参考素材"}` : tab === "text" ? "附件已上传" : "参考素材已上传");
    }
    setUploading(false);
    setUploadProgress(0);
  };

  const handleReferenceChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadReferenceFiles(picked, referencePickerOpen ? "picker" : "references");
  };

  const handleReferenceDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (canUploadReferences) setReferenceDragActive(true);
  };

  const handleReferenceDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (canUploadReferences) {
      event.dataTransfer.dropEffect = "copy";
      setReferenceDragActive(true);
    } else {
      event.dataTransfer.dropEffect = "none";
    }
  };

  const handleReferenceDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setReferenceDragActive(false);
    }
  };

  const handleReferenceDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setReferenceDragActive(false);
    if (!canUploadReferences) return;
    await uploadReferenceFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const removeReference = (fileUrl: string) => {
    if (tab === "text") {
      setChatAttachments((current) => current.filter((file) => file.fileUrl !== fileUrl));
      return;
    }
    setReferences((current) => current.filter((file) => file.fileUrl !== fileUrl));
    setPromptReferenceKeys((current) => current.filter((key) => key !== fileUrl));
  };
  const removeReferencePickerFile = (file: FileVO) => {
    const key = fileKey(file);
    const keep = (item: FileVO) => fileKey(item) !== key;
    setReferencePickerGeneratedFiles((current) => current.filter(keep));
    setReferencePickerUploadedFiles((current) => current.filter(keep));
    setReferencePickerLocalFiles((current) => current.filter(keep));
    setReferences((current) => current.filter(keep));
    setPromptReferenceKeys((current) => current.filter((item) => item !== key));
    setReferencePickerSelected((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setReferencePickerPreviewFile((current) => current && fileKey(current) === key ? null : current);
  };

  const deleteReferencePickerFile = async (file: FileVO) => {
    const key = fileKey(file);
    if (referencePickerDeletingKey) return;
    if (isTemporaryFile(file)) {
      removeReferencePickerFile(file);
      toast.info("已从当前列表移除");
      return;
    }
    setReferencePickerDeletingKey(key);
    try {
      const res = await fileApi.delete(file.id);
      if (res.success) {
        removeReferencePickerFile(file);
        toast.success("图片已删除");
      } else {
        toast.error(res.message || "删除失败");
      }
    } catch (error) {
      toast.error((error as Error)?.message || "删除失败");
    } finally {
      setReferencePickerDeletingKey("");
    }
  };

  const requestDeleteReferencePickerFile = (file: FileVO) => {
    if (referencePickerDeletingKey) return;
    if (isTemporaryFile(file)) {
      void deleteReferencePickerFile(file);
      return;
    }
    setReferencePickerDeleteTarget(file);
  };

  const confirmDeleteReferencePickerFile = async () => {
    const file = referencePickerDeleteTarget;
    if (!file || referencePickerDeletingKey) return;
    await deleteReferencePickerFile(file);
    setReferencePickerDeleteTarget((current) => (current && fileKey(current) === fileKey(file) ? null : current));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (tab !== "text" && e.key === "Backspace") {
      const atPromptStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
      if (promptReferenceKeys.length && (!prompt || atPromptStart)) {
        e.preventDefault();
        setReferenceMentionOpen(false);
        setPromptReferenceKeys((current) => current.slice(0, -1));
        window.requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
    }
    if (tab !== "text" && e.key === "@") {
      e.preventDefault();
      setPendingReferenceMentionRange(null);
      if (references.length) {
        setReferenceMentionOpen(true);
      } else {
        openReferencePicker();
      }
      return;
    }
    if (referenceMentionOpen && e.key === "Escape") {
      e.preventDefault();
      setReferenceMentionOpen(false);
      return;
    }
    if (referenceMentionOpen && e.key === "Enter") {
      e.preventDefault();
      const firstAvailable = references.find((file) => !promptReferenceKeySet.has(fileKey(file))) ?? references[0];
      if (firstAvailable) addPromptReference(firstAvailable);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const filesFromMessage = (message: ConversationMessageVO): FileVO[] =>
    message.files.map((file) => ({ ...file, id: file.id } as FileVO));

  const mediaURLsFromMessage = (message: ConversationMessageVO): string[] => {
    const urls = Array.isArray(message.metadata?.urls)
      ? message.metadata.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const primary = typeof message.metadata?.url === "string" ? message.metadata.url : "";
    return Array.from(new Set([primary, ...urls].filter(Boolean)));
  };

  const handleCopyMessage = async (message: ConversationMessageVO) => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  };

  const handleEditMessage = (message: ConversationMessageVO) => {
    if (message.role !== "user") return;
    setPrompt(message.content);
    setEditingParentMessageId(message.parentMessageId);
    const files = filesFromMessage(message);
    if (tab === "text") setChatAttachments(files);
    else setReferences(files);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(message.content.length, message.content.length);
    });
  };

  const handleRegenerateMessage = (message: ConversationMessageVO) => {
    if (message.role !== "assistant") return;
    const userMessage = conversationMessages.find((item) => item.id === message.parentMessageId && item.role === "user");
    if (!userMessage) return;
    if (message.contentType === "text") {
      void sendTextMessage({
        content: userMessage.content,
        attachments: filesFromMessage(userMessage),
        parentMessageId: userMessage.parentMessageId,
      });
      return;
    }
    const metadata = message.metadata ?? {};
    const params = metadata.params && typeof metadata.params === "object"
      ? metadata.params as Record<string, unknown>
      : {};
    const kind: MediaTab = message.contentType === "video" ? "video" : "image";
    const model = models.find((item) => item.modelId === message.modelId)
      ?? models.find((item) => item.type === (kind === "video" ? AiModelType.VIDEO : AiModelType.IMAGE));
    void doGenerate({
      prompt: userMessage.content,
      kind,
      modelId: model?.modelId ?? message.modelId ?? "",
      modelName: model?.name ?? message.modelName ?? "",
      ratio: typeof metadata.ratio === "string" ? metadata.ratio : "",
      imageQuality: params.quality === "high" ? "high" : "standard",
      imageResolution: typeof params.resolution === "string" ? params.resolution.toUpperCase() : imageResolution,
      imageCount: typeof params.batchCount === "number" ? params.batchCount : 1,
      videoResolution: typeof params.resolution === "string" ? params.resolution.toUpperCase() : videoResolution,
      videoDuration: typeof params.duration === "number" ? params.duration : videoDuration,
      videoAudio: params.generateAudio !== false,
      videoReferenceMode: typeof metadata.referenceMode === "string" ? metadata.referenceMode as VideoReferenceMode : videoReferenceMode,
      references: filesFromMessage(userMessage),
      parentMessageId: userMessage.parentMessageId,
    });
  };

  const handleStopMessage = async (message: ConversationMessageVO) => {
    if (!activeConversation || !message.taskId) return;
    const res = await aiApi.cancelTask(message.taskId);
    if (!res.success) {
      toast.error(res.message || "停止失败");
      return;
    }
    await persistConversationMessagePatch(activeConversation.id, message.id, {
      status: "cancelled",
      content: "已停止生成，扣除的积分已退回。",
      metadata: message.metadata,
    });
  };

  const handleDownloadMessage = async (message: ConversationMessageVO) => {
    const urls = mediaURLsFromMessage(message);
    if (!urls.length) return;
    const ext = message.contentType === "video" ? "mp4" : "png";
    for (const [index, url] of urls.entries()) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("download failed");
        const blobURL = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = blobURL;
        anchor.download = `tidecanvas-${message.id}-${index + 1}.${ext}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(blobURL);
      } catch {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
  };

  const handleAddMessageToLibrary = async (message: ConversationMessageVO) => {
    if (!activeConversation || message.metadata?.saved === true) return;
    const urls = mediaURLsFromMessage(message);
    if (!urls.length) return;
    const userMessage = conversationMessages.find((item) => item.id === message.parentMessageId);
    const assetFileIds: string[] = [];
    for (const [index, url] of urls.entries()) {
      const res = await fileApi.saveFromUrl({
        url,
        fileType: message.contentType,
        originalName: `${(userMessage?.content || `${message.contentType} result`).slice(0, 36)}${urls.length > 1 ? `-${index + 1}` : ""}`,
      });
      if (!res.success) {
        toast.error(res.message || "添加到素材库失败");
        return;
      }
      assetFileIds.push(String(res.data.id));
    }
    await persistConversationMessagePatch(activeConversation.id, message.id, {
      metadata: { ...(message.metadata ?? {}), saved: true, assetFileIds },
    });
    toast.success("已添加到素材库");
  };

  const handleContinueMessage = (message: ConversationMessageVO) => {
    const url = typeof message.metadata?.url === "string" ? message.metadata.url : "";
    if (!url || (message.contentType !== "image" && message.contentType !== "video")) return;
    const existing = message.files.find((file) => file.relation === "result");
    const reference = existing
      ? ({ ...existing, id: existing.id } as FileVO)
      : ({
          id: negativeIdFromString(url),
          originalName: message.contentType === "video" ? "生成视频.mp4" : "生成图片.png",
          fileUrl: url,
          fileSize: 0,
          fileType: message.contentType === "video" ? FileType.VIDEO : FileType.IMAGE,
          mimeType: message.contentType === "video" ? "video/mp4" : "image/png",
          storageType: url.startsWith("/uploads/") ? "local" : "oss",
          createTime: message.createTime,
        } as FileVO);
    setReferences([reference]);
    setPrompt(message.contentType === "video" ? "基于这个视频继续修改：" : "基于这张图片继续修改：");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSelectBranch = async (message: ConversationMessageVO) => {
    if (!activeConversation) return;
    const leaf = deepestLatestDescendant(message, conversationMessages);
    const res = await conversationApi.update(activeConversation.id, { activeLeafMessageId: leaf.id });
    if (!res.success) {
      toast.error(res.message || "切换分支失败");
      return;
    }
    setActiveConversation(res.data);
    setConversationMessages(res.data.messages ?? conversationMessages);
  };

  return (
    <>
      <section className="relative z-30 flex min-h-screen flex-col overflow-hidden bg-[#f7f8fa] px-4 pt-14 text-neutral-950 sm:px-6 lg:px-8 dark:bg-[#101114] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[linear-gradient(to_bottom,#f3f5f8,rgba(247,248,250,0.9)_64%,#f7f8fa)] dark:bg-[linear-gradient(to_bottom,#17181d,rgba(16,17,20,0.92)_64%,#101114)]" />

      <div className={(!hasConversationContent
        ? "mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-[1120px] flex-col justify-center pb-[10vh] pt-8"
        : "mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1280px] flex-col")}>
        <div className={(!hasConversationContent ? "px-1" : "min-h-0 flex-1 px-1 pt-8 sm:pt-12")}>
          {conversationLoading && (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />正在加载会话...
            </div>
          )}
          {!conversationLoading && visibleConversationMessages.length > 0 && (
            <CreationMessageList
              messages={visibleConversationMessages}
              allMessages={conversationMessages}
              onCopy={handleCopyMessage}
              onEdit={handleEditMessage}
              onRegenerate={handleRegenerateMessage}
              onStop={handleStopMessage}
              onDownload={handleDownloadMessage}
              onAddToLibrary={handleAddMessageToLibrary}
              onContinue={handleContinueMessage}
              onSelectBranch={handleSelectBranch}
            />
          )}
          <div ref={chatEndRef} />
        </div>
        <div className={(!hasConversationContent
          ? "relative z-40 px-0 pb-0 pt-0"
          : "sticky bottom-4 z-40 -mx-4 bg-[linear-gradient(to_top,#f7f8fa_74%,rgba(247,248,250,0))] px-4 pb-0 pt-3 sm:-mx-6 sm:px-6 dark:bg-[linear-gradient(to_top,#101114_74%,rgba(16,17,20,0))]")}>
          <div className={(!hasConversationContent ? "mx-auto w-full max-w-[920px]" : "mx-auto w-full max-w-[960px]")}>
            <div
              data-type-open={typeOpen ? "true" : undefined}
              className="relative z-30 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-neutral-950"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple={referenceLimit > 1}
                accept={tab === "text" ? "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv" : tab === "video" ? "image/*,video/*" : "image/*"}
                className="hidden"
                onChange={handleReferenceChange}
              />

              <div
                className="min-h-[154px]"
                onDragEnter={handleReferenceDragEnter}
                onDragOver={handleReferenceDragOver}
                onDragLeave={handleReferenceDragLeave}
                onDrop={handleReferenceDrop}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-4 sm:gap-5">
                    {CREATION_TYPE_OPTIONS.map((item) => {
                      const Icon = item.icon;
                      const active = item.id === tab;
                      const supported = true;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => { setTypeOpen(false); selectCreationType(item.id); }}
                          className={(active
                            ? "bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950"
                            : supported
                              ? "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white"
                              : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white") +
                            " flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors"}
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => textareaRef.current?.focus()}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-200 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
                    title="展开"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="relative mt-2 flex min-h-[86px] w-full flex-wrap content-start items-start gap-1.5"
                  onClick={() => textareaRef.current?.focus()}
                >
                  {tab !== "text" && promptReferenceFiles.map((file) => {
                    const referenceIndex = references.findIndex((item) => fileKey(item) === fileKey(file));
                    return (
                      <InlineReferenceChip
                        key={fileKey(file)}
                        file={file}
                        mention={getReferenceMention(file, referenceIndex >= 0 ? referenceIndex : 0)}
                        onRemove={() => removePromptReference(file)}
                      />
                    );
                  })}
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={onKeyDown}
                    onDoubleClick={tab === "text" ? undefined : handlePromptDoubleClick}
                    placeholder={promptReferenceFiles.length ? "" : composerPlaceholder}
                    rows={2}
                    style={{ outline: "none", boxShadow: "none", border: "none" }}
                    className="prompt-scroll block min-h-[44px] min-w-[220px] flex-1 resize-none border-0 bg-transparent px-0 text-[13px] leading-5 text-neutral-800 placeholder:text-neutral-400 outline-none transition-[height] duration-150 ease-out focus:outline-none focus:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  />
                  {tab !== "text" && referenceMentionOpen && references.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => { setReferenceMentionOpen(false); setPendingReferenceMentionRange(null); }} />
                      <ReferenceMentionMenu
                        files={references}
                        selectedKeys={promptReferenceKeySet}
                        getMention={getReferenceMention}
                        onSelect={addPromptReference}
                      />
                    </>
                  )}
                </div>
                <div className="mt-5 flex min-h-[56px] items-end gap-3 overflow-visible">
                  {activeAttachments.length === 0 ? (
                    <button
                      type="button"
                      onClick={openReferencePicker}
                      disabled={!canUploadReferences}
                      className={(referenceDragActive
                        ? "border-neutral-950 bg-neutral-50 text-neutral-950 ring-2 ring-neutral-950/10 dark:border-white dark:bg-white/10 dark:text-white dark:ring-white/15"
                        : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-white/10 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/12") +
                        " flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-60"}
                      title={tab === "text" ? "点击或拖拽添加附件" : tab === "video" ? "点击或拖拽上传参考素材" : "点击或拖拽上传参考图"}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      <span className="text-[13px] font-medium leading-none">{tab === "text" ? "附件" : tab === "video" ? "素材" : "图片"}</span>
                    </button>
                  ) : (
                    <div className="relative h-[74px] w-[82px] shrink-0 overflow-visible">
                      {activeAttachments.slice(0, 3).map((file, index) => (
                        <ReferencePreviewTile key={fileKey(file)} file={file} index={index} stackIndex={index} onUse={tab === "text" ? () => textareaRef.current?.focus() : addPromptReference} onRemove={removeReference} />
                      ))}
                      {activeAttachments.length > 3 && (
                        <span className="absolute left-[46px] top-[7px] z-30 flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-950 px-1 text-[10px] font-semibold text-white shadow-sm dark:bg-white dark:text-neutral-950">
                          +{activeAttachments.length - 3}
                        </span>
                      )}
                      {canUploadReferences && (
                        <button
                          type="button"
                          onClick={openReferencePicker}
                          disabled={uploading}
                          className="absolute left-[42px] top-[50px] z-40 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 shadow-[0_4px_14px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.06] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/14 dark:text-neutral-100 dark:ring-white/10 dark:hover:bg-white/20"
                          title={`继续添加${uploadLabel}`}
                        >
                          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {uploading && <span className="mt-1 block text-[10px] text-neutral-400">{uploadProgress || 0}%</span>}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => { if (!tabModels.length) return; setModelOpen((o) => !o); setTypeOpen(false); setRatioOpen(false); setCountOpen(false); setReferenceModeOpen(false); }}
                      className={(modelSelectable ? "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10" : "cursor-default text-neutral-400 dark:text-neutral-500") + " flex h-9 max-w-[240px] items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium transition-colors dark:border-white/10 dark:bg-white/8"}
                    >
                      <Box className="h-3.5 w-3.5" />
                      <span className="truncate">{modelLabel}</span>
                      {modelSelectable && <ChevronDown className={(modelOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />}
                    </button>
                    {modelOpen && modelSelectable && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[min(18rem,calc(100vh-24px))] w-[260px] overflow-auto rounded-lg border border-neutral-200 bg-white/96 p-1.5 shadow-[0_16px_42px_rgba(15,23,42,0.16)] backdrop-blur dark:border-white/10 dark:bg-neutral-950/96">
                          {tabModels.map((m) => (
                            <button
                              key={m.modelId}
                              type="button"
                              onClick={() => selectModel(m.modelId)}
                              className={(m.modelId === selectedModelId
                                ? "bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950"
                                : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10") + " flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors"}
                            >
                              <span
                                className={(m.modelId === selectedModelId
                                  ? "bg-white/12 text-white dark:bg-neutral-950/10 dark:text-neutral-950"
                                  : "bg-neutral-100 text-neutral-500 dark:bg-white/8 dark:text-neutral-300") + " flex h-6 w-6 shrink-0 items-center justify-center rounded-md"}
                              >
                                <Box className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-left">{m.name}</span>
                              {m.modelId === selectedModelId && <Check className="h-3.5 w-3.5 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {tab === "video" && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => { setReferenceModeOpen((open) => !open); setTypeOpen(false); setModelOpen(false); setRatioOpen(false); setCountOpen(false); }}
                        className="flex h-9 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-white/10 dark:bg-white/8 dark:text-neutral-200 dark:hover:bg-white/10"
                      >
                        <ReferenceModeIcon className="h-3.5 w-3.5" />
                        {referenceModeLabel}
                        <ChevronDown className={(referenceModeOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                      </button>
                      {referenceModeOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setReferenceModeOpen(false)} />
                          <div className="absolute bottom-full left-0 z-50 mb-3 w-[184px] rounded-xl bg-white p-1.5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.08] dark:bg-[#25262b] dark:ring-white/10">
                            {VIDEO_REFERENCE_MODE_OPTIONS.map((item) => {
                              const Icon = item.icon;
                              const active = item.id === videoReferenceMode;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => { setVideoReferenceMode(item.id); setReferenceModeOpen(false); }}
                                  className={(active
                                    ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white"
                                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/8") +
                                    " flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors"}
                                >
                                  <Icon className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                                  {active && <Check className="h-4 w-4 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {tab === "image" ? (
                    <QualityRatioDropdown
                      value={imageParamValue}
                      onChange={(next) => {
                        setRatio(next.ratio);
                        setImageQuality(next.quality);
                        setImageResolution(next.clarity);
                      }}
                      open={ratioOpen}
                      onOpenChange={(open) => {
                        setRatioOpen(open);
                        if (open) {
                          setTypeOpen(false);
                          setModelOpen(false);
                          setCountOpen(false);
                          setReferenceModeOpen(false);
                        }
                      }}
                      ratios={IMAGE_RATIO_OPTIONS}
                      batchCount={effectiveImageCount}
                      compact
                      composer
                    />
                  ) : tab === "video" ? (
                    <div className="relative min-w-0">
                      <button
                        ref={ratioButtonRef}
                        type="button"
                        onClick={() => { setRatioOpen((o) => !o); setTypeOpen(false); setModelOpen(false); setCountOpen(false); setReferenceModeOpen(false); }}
                        className="flex h-9 max-w-[280px] items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-white/10 dark:bg-white/8 dark:text-neutral-200 dark:hover:bg-white/10"
                        aria-expanded={ratioOpen}
                        aria-haspopup="dialog"
                        aria-controls="home-video-parameter-panel"
                      >
                        <Crop className="h-3.5 w-3.5" />
                        <span className="truncate">{paramSummary}</span>
                        <ChevronDown className={(ratioOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                      </button>
                      {ratioOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setRatioOpen(false)} />
                          <div
                            id="home-video-parameter-panel"
                            ref={ratioPanelRef}
                            className={`${parameterStyles.panel} ${parameterStyles.panelComposer} absolute z-50 overflow-x-hidden`}
                            style={ratioPanelStyle}
                            role="dialog"
                            aria-label="视频参数"
                            aria-modal="false"
                            onMouseDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                          >
                            <VideoParamControls
                              composer
                              value={effectiveVideoParam}
                              onChange={updateVideoParam}
                              ratios={selectedVideoOptions.ratios}
                              resolutions={selectedVideoOptions.resolutions}
                              durations={selectedVideoOptions.durations}
                              allowAudio={selectedVideoOptions.allowAudio}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}

                  {tab === "image" && (
                    <BatchCountDropdown
                      value={effectiveImageCount}
                      options={safeImageCountOptions}
                      open={countOpen}
                      onOpenChange={(open) => {
                        setCountOpen(open);
                        if (open) {
                          setTypeOpen(false);
                          setModelOpen(false);
                          setRatioOpen(false);
                          setReferenceModeOpen(false);
                        }
                      }}
                      onChange={setImageCount}
                      composer
                    />
                  )}
                </div>

                <div className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 dark:border-white/10 dark:bg-white/10">
                  <span className={(canSubmit
                    ? "text-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-white/50") +
                    " flex h-7 items-center gap-1 rounded-md px-2.5 text-[13px] font-semibold"}
                    title="本次生成消耗积分"
                  >
                    <Zap className="h-3.5 w-3.5 fill-current" />
                    {displayPointCost}
                  </span>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    aria-label={t("send")}
                    className={(canSubmit
                      ? "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-100"
                      : "cursor-not-allowed bg-neutral-200 text-neutral-400 dark:bg-white/10 dark:text-white/40") +
                      " flex h-7 w-7 items-center justify-center rounded-md transition-colors"}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </section>
      <ReferencePickerDialog
        open={referencePickerOpen}
        tab={referencePickerTab}
        files={referencePickerDisplayFiles}
        loading={referencePickerLoading}
        loaded={referencePickerLoaded}
        selected={referencePickerSelected}
        notice={referencePickerNotice}
        selectedTotal={referencePickerSelectedTotal}
        limit={referenceLimit}
        uploadLabel={uploadLabel}
        uploading={uploading}
        uploadProgress={uploadProgress}
        canUpload={canUploadReferences}
        deletingKey={referencePickerDeletingKey}
        onTabChange={setReferencePickerTab}
        onClose={() => { setReferencePickerOpen(false); setReferencePickerDeleteTarget(null); }}
        onRefresh={() => setReferencePickerRefreshKey((key) => key + 1)}
        onSelect={toggleReferencePickerFile}
        onPreview={setReferencePickerPreviewFile}
        onDelete={requestDeleteReferencePickerFile}
        onConfirm={confirmReferencePicker}
        onUploadClick={() => fileInputRef.current?.click()}
        onUploadDrop={(files) => uploadReferenceFiles(files, "picker")}
      />
      <ReferenceDeleteConfirmDialog
        file={referencePickerDeleteTarget}
        deleting={Boolean(referencePickerDeleteTarget && referencePickerDeletingKey === fileKey(referencePickerDeleteTarget))}
        onCancel={() => setReferencePickerDeleteTarget(null)}
        onConfirm={confirmDeleteReferencePickerFile}
      />
      <ReferenceMediaPreviewDialog key={referencePickerPreviewFile?.fileUrl ?? "empty-preview"} file={referencePickerPreviewFile} onClose={() => setReferencePickerPreviewFile(null)} />
    </>
  );
}

interface ReferencePickerDialogProps {
  open: boolean;
  tab: ReferencePickerTab;
  files: FileVO[];
  loading: boolean;
  loaded: boolean;
  selected: Record<string, FileVO>;
  notice: string;
  selectedTotal: number;
  limit: number;
  uploadLabel: string;
  uploading: boolean;
  uploadProgress: number;
  canUpload: boolean;
  deletingKey: string;
  onTabChange: (tab: ReferencePickerTab) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (file: FileVO) => void;
  onPreview: (file: FileVO) => void;
  onDelete: (file: FileVO) => void | Promise<void>;
  onConfirm: () => void;
  onUploadClick: () => void;
  onUploadDrop: (files: File[]) => void | Promise<void>;
}

function ReferencePickerDialog({
  open,
  tab,
  files,
  loading,
  loaded,
  selected,
  notice,
  selectedTotal,
  limit,
  uploadLabel,
  uploading,
  uploadProgress,
  canUpload,
  deletingKey,
  onTabChange,
  onClose,
  onRefresh,
  onSelect,
  onPreview,
  onDelete,
  onConfirm,
  onUploadClick,
  onUploadDrop,
}: ReferencePickerDialogProps) {
  const [dragActive, setDragActive] = useState(false);
  if (!open) return null;

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (!canUpload) return;
    void onUploadDrop(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 px-6 py-5 text-neutral-950 dark:text-white">
      <div className="flex h-[min(88vh,920px)] w-[min(1500px,calc(100vw-72px))] flex-col overflow-hidden rounded-lg bg-white shadow-[0_28px_90px_rgba(0,0,0,0.34)] dark:bg-[#1d1e23]">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2 className="text-lg font-semibold">选择要上传的图片</h2>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onRefresh} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white" title="刷新">
              <RefreshCw className={(loading ? "animate-spin " : "") + "h-4 w-4"} />
            </button>
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white" title="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex items-end justify-between border-b border-neutral-200 px-6 dark:border-white/10">
          <div className="flex items-center gap-6">
            {REFERENCE_PICKER_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={(tab === item.id
                  ? "border-[#2f6fff] text-neutral-950 dark:text-white"
                  : "border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white") +
                  " border-b-2 px-0 pb-2 text-sm font-medium transition-colors"}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pb-2 text-sm text-neutral-500 dark:text-neutral-400">
            <span>以下是最近上传/生成的文件，已选 <span className="text-[#2f6fff]">{selectedTotal}/{limit}</span> 张</span>
            {notice && <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-[#2f6fff] dark:bg-blue-500/10">{notice}</span>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <button
              type="button"
              onClick={canUpload ? onUploadClick : undefined}
              onDragEnter={(event) => { event.preventDefault(); if (canUpload) setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = canUpload ? "copy" : "none"; if (canUpload) setDragActive(true); }}
              onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
              onDrop={handleDrop}
              disabled={!canUpload || uploading}
              className={(dragActive
                ? "border-[#2f6fff] bg-blue-50 text-[#2f6fff] ring-2 ring-[#2f6fff]/20"
                : "border-neutral-300 bg-white text-neutral-700 hover:border-[#2f6fff] hover:text-[#2f6fff] dark:border-white/15 dark:bg-white/5 dark:text-neutral-200") +
                " group/upload relative flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed transition-all disabled:cursor-not-allowed disabled:opacity-60"}
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#2f6fff]/12 to-transparent opacity-0 transition-opacity duration-300 group-hover/upload:translate-x-0 group-hover/upload:opacity-100" />
              <span className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-50 text-[#2f6fff] ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
              </span>
              <span className="relative mt-3 text-sm font-semibold text-[#2f6fff]">点击上传</span>
              <span className="relative mt-2 text-sm text-neutral-500 dark:text-neutral-400">或</span>
              <span className="relative mt-2 text-sm text-neutral-700 dark:text-neutral-200">拖拽本地{uploadLabel}至此上传</span>
              {uploading && (
                <span className="absolute inset-x-6 bottom-6 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
                  <span className="block h-full rounded-full bg-[#2f6fff] transition-all" style={{ width: `${uploadProgress || 8}%` }} />
                </span>
              )}
            </button>

            {files.map((file) => {
              const key = fileKey(file);
              return (
                <ReferencePickerCard
                  key={key}
                  file={file}
                  selected={Boolean(selected[key])}
                  deleting={deletingKey === key}
                  onClick={() => onSelect(file)}
                  onPreview={() => onPreview(file)}
                  onDelete={() => onDelete(file)}
                />
              );
            })}
          </div>
          {!loading && loaded && files.length === 0 && (
            <div className="flex h-48 items-center justify-center text-sm text-neutral-400">暂无历史图片，先上传一张试试</div>
          )}
          {loading && (
            <div className="flex h-48 items-center justify-center text-neutral-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-6 py-4 dark:border-white/10">
          <button type="button" onClick={onClose} className="h-10 rounded-md px-5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10">取消</button>
          <button type="button" onClick={onConfirm} className="h-10 rounded-md bg-[#2f6fff] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#1f5be8] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400" disabled={selectedTotal === 0}>确定</button>
        </div>
      </div>
    </div>
  );
}

function ReferenceDeleteConfirmDialog({
  file,
  deleting,
  onCancel,
  onConfirm,
}: {
  file: FileVO | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!file) return null;
  const title = file.originalName || "这张图片";

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/10 px-4" onClick={deleting ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-delete-title"
        className="w-[min(420px,calc(100vw-40px))] rounded-lg bg-white p-5 text-neutral-950 shadow-[0_20px_70px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.06] dark:bg-[#1f2026] dark:text-white dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-300">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <h3 id="reference-delete-title" className="text-base font-semibold">删除图片</h3>
              <p className="mt-1 max-w-[300px] truncate text-sm text-neutral-500 dark:text-neutral-400">{title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white"
            title="关闭"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-300">确定删除这张图片吗？删除后会从历史文件和当前已选参考中移除，此操作不可撤销。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="h-9 rounded-md px-4 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => { void onConfirm(); }}
            disabled={deleting}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
function ReferencePickerCard({
  file,
  selected,
  deleting,
  onClick,
  onPreview,
  onDelete,
}: {
  file: FileVO;
  selected: boolean;
  deleting: boolean;
  onClick: () => void;
  onPreview: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const isVideo = isVideoFile(file);
  const generated = isTemporaryFile(file);
  const sourceLabel = generated ? "生成" : "上传";
  const title = file.originalName || (isVideo ? "视频素材" : "参考图片");

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      title={title}
      className={(selected ? "ring-2 ring-[#2f6fff]" : "ring-1 ring-black/[0.08] hover:ring-[#2f6fff]/50 dark:ring-white/10") + " group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-lg bg-neutral-100 text-left shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#2f6fff] dark:bg-white/8"}
    >
      {mediaFailed ? (
        <ReferenceMediaFallback title={title} isVideo={isVideo} />
      ) : isVideo ? (
        <>
          {!mediaLoaded && <ReferenceMediaSkeleton isVideo />}
          <video
            src={file.fileUrl}
            muted
            preload="metadata"
            onLoadedData={() => setMediaLoaded(true)}
            onError={() => setMediaFailed(true)}
            className={(mediaLoaded ? "opacity-100" : "opacity-0") + " h-full w-full object-cover transition-opacity"}
          />
        </>
      ) : (
        <>
          {!mediaLoaded && <ReferenceMediaSkeleton />}
          <img
            src={file.fileUrl}
            alt=""
            loading="lazy"
            onLoad={() => setMediaLoaded(true)}
            onError={() => setMediaFailed(true)}
            className={(mediaLoaded ? "opacity-100" : "opacity-0") + " h-full w-full object-cover transition-opacity"}
          />
        </>
      )}
      <span className="absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{sourceLabel}</span>
      {selected && (
        <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#2f6fff] text-white ring-2 ring-white">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
      <span className={(mediaFailed ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100") + " pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pr-20 pt-8 text-xs font-medium text-white"}>
        {mediaFailed ? "原图暂不可预览" : title}
      </span>
      <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); void onDelete(); }}
          disabled={deleting}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-neutral-700 shadow-sm ring-1 ring-black/10 transition-colors hover:bg-white hover:text-red-600 disabled:cursor-wait disabled:text-neutral-400 dark:bg-neutral-950/88 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-neutral-900 dark:hover:text-red-300"
          title={generated ? "从列表移除" : "删除图片"}
          aria-label={generated ? "从列表移除" : "删除图片"}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onPreview(); }}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-neutral-700 shadow-sm ring-1 ring-black/10 transition-colors hover:bg-white hover:text-[#2f6fff] dark:bg-neutral-950/88 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-neutral-900 dark:hover:text-blue-300"
          title="放大预览"
          aria-label="放大预览"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ReferenceMediaPreviewDialog({ file, onClose }: { file: FileVO | null; onClose: () => void }) {
  const [previewTransform, setPreviewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [previewPanning, setPreviewPanning] = useState(false);
  const previewPanningRef = useRef(false);
  const previewPanStartRef = useRef({ pointerX: 0, pointerY: 0, panX: 0, panY: 0 });

  if (!file) return null;
  const isVideo = isVideoFile(file);
  const title = file.originalName || (isVideo ? "视频素材" : "参考图片");
  const minPreviewScale = 0.3;
  const maxPreviewScale = 4;
  const previewScale = previewTransform.scale;
  const scaled = Math.abs(previewScale - 1) > 0.001;
  const canPanPreview = !isVideo && previewScale > 1;
  const clampPreviewScale = (value: number) => Math.min(maxPreviewScale, Math.max(minPreviewScale, Number(value.toFixed(2))));
  const adjustPreviewScale = (delta: number) => {
    setPreviewTransform((current) => {
      const nextScale = clampPreviewScale(current.scale + delta);
      return nextScale <= 1 ? { scale: nextScale, x: 0, y: 0 } : { ...current, scale: nextScale };
    });
  };
  const mediaClass = scaled
    ? "max-h-none max-w-none rounded-lg object-contain shadow-[0_18px_64px_rgba(0,0,0,0.24)]"
    : "max-h-[calc(100vh-112px)] max-w-full rounded-lg object-contain shadow-[0_18px_64px_rgba(0,0,0,0.24)]";
  const mediaStyle = scaled || canPanPreview
    ? {
        ...(scaled ? { width: `min(${Math.round(previewScale * 100)}vw, ${Math.round(previewScale * 1120)}px)` } : {}),
        ...(canPanPreview
          ? {
              cursor: previewPanning ? "grabbing" : "grab",
              transform: `translate3d(${previewTransform.x}px, ${previewTransform.y}px, 0)`,
            }
          : {}),
      }
    : undefined;
  const previewButtonClass =
    "flex h-10 w-10 items-center justify-center rounded-md bg-white/90 text-neutral-800 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-neutral-950";

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    adjustPreviewScale(event.deltaY > 0 ? -0.15 : 0.15);
  };

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPanPreview || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    previewPanningRef.current = true;
    setPreviewPanning(true);
    previewPanStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      panX: previewTransform.x,
      panY: previewTransform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!previewPanningRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = previewPanStartRef.current;
    setPreviewTransform((current) => ({
      ...current,
      x: start.panX + event.clientX - start.pointerX,
      y: start.panY + event.clientY - start.pointerY,
    }));
  };

  const stopPreviewPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!previewPanningRef.current) return;
    previewPanningRef.current = false;
    setPreviewPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center overflow-hidden bg-black/35 py-14 pl-6 pr-20 text-white" onClick={onClose}>
      <div className="fixed right-5 top-5 z-[170] flex flex-col gap-4 sm:right-7 sm:top-6" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-white/90 text-neutral-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-neutral-950"
          title="关闭"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => adjustPreviewScale(0.25)}
          className={previewButtonClass}
          title="放大"
          aria-label="放大"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => adjustPreviewScale(-0.25)}
          className={previewButtonClass}
          title="缩小"
          aria-label="缩小"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
      </div>
      <div
        className={(scaled ? "max-w-none" : "max-w-[min(1120px,calc(100vw-128px))]") + " relative flex max-h-[calc(100vh-112px)] items-center justify-center"}
        onClick={(event) => event.stopPropagation()}
        onWheel={handlePreviewWheel}
        onPointerDown={handlePreviewPointerDown}
        onPointerMove={handlePreviewPointerMove}
        onPointerUp={stopPreviewPan}
        onPointerCancel={stopPreviewPan}
      >
        {isVideo ? (
          <video src={file.fileUrl} controls autoPlay className={mediaClass} style={mediaStyle} />
        ) : (

          <img src={file.fileUrl} alt={title} className={mediaClass} draggable={false} style={mediaStyle} />
        )}
      </div>
    </div>
  );
}
function ReferenceMediaSkeleton({ isVideo = false }: { isVideo?: boolean }) {
  const Icon = isVideo ? Video : ImageIcon;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,#f4f6f8,#eceff3)] text-neutral-300 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] dark:text-neutral-600">
      <Icon className="h-7 w-7" />
    </div>
  );
}

function ReferenceMediaFallback({ title, isVideo }: { title: string; isVideo: boolean }) {
  const Icon = isVideo ? Video : ImageIcon;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,#f6f7f9,#edf0f4)] px-4 text-center text-neutral-500 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] dark:text-neutral-400">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-neutral-400 shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:text-neutral-500 dark:ring-white/10">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">预览不可用</span>
      <span className="max-h-8 max-w-full overflow-hidden break-all text-[11px] leading-4 text-neutral-400 dark:text-neutral-500">{title}</span>
    </div>
  );
}
function ReferenceMentionMenu({
  files,
  selectedKeys,
  getMention,
  onSelect,
}: {
  files: FileVO[];
  selectedKeys: Set<string>;
  getMention: (file: FileVO, index: number) => string;
  onSelect: (file: FileVO) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-48px))] rounded-lg border border-black/[0.06] bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.04] dark:border-white/10 dark:bg-[#25262b] dark:ring-white/10">
      <div className="px-2 py-1.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">选择要插入提示词的参考内容</div>
      <div className="max-h-64 overflow-auto pr-1">
        {files.map((file, index) => {
          const key = fileKey(file);
          const active = selectedKeys.has(key);
          const isImage = file.fileType === "image" || file.mimeType?.startsWith("image/");
          const isVideo = file.fileType === "video" || file.mimeType?.startsWith("video/");
          const mention = getMention(file, index);
          return (
            <button
              key={key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(file)}
              className={(active
                ? "bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950"
                : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-white/8") +
                " flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 ring-1 ring-black/[0.05] dark:bg-white/10 dark:ring-white/10">
                {isImage ? (
                  <img src={file.fileUrl} alt="" className="h-full w-full object-cover" />
                ) : isVideo ? (
                  <Video className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{mention}</span>
                <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">{file.originalName || (active ? "已在提示词中" : "点击插入提示词")}</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function InlineReferenceChip({ file, mention, onRemove }: { file: FileVO; mention: string; onRemove: () => void }) {
  const [failed, setFailed] = useState(false);
  const isImage = file.fileType === "image" || file.mimeType?.startsWith("image/");
  const isVideo = file.fileType === "video" || file.mimeType?.startsWith("video/");
  const title = file.originalName || mention;

  return (
    <span
      className="group/ref-chip inline-flex h-7 max-w-[150px] items-center gap-1.5 rounded-md border border-neutral-200 bg-white py-0.5 pl-1 pr-1.5 text-[13px] font-medium leading-none text-neutral-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-neutral-300 dark:border-white/10 dark:bg-white/10 dark:text-neutral-100"
      title={title}
    >
      <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-[4px] bg-neutral-100 dark:bg-white/10">
        {isImage && !failed ? (
          <img src={file.fileUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : isVideo ? (
          <span className="flex h-full w-full items-center justify-center text-neutral-500 dark:text-neutral-300"><Video className="h-3 w-3" /></span>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-neutral-500 dark:text-neutral-300"><ImageIcon className="h-3 w-3" /></span>
        )}
      </span>
      <span className="max-w-[88px] truncate">{mention}</span>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => { event.stopPropagation(); onRemove(); }}
        className="-ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-0 transition-colors hover:bg-neutral-100 hover:text-neutral-900 group-hover/ref-chip:opacity-100 group-focus-within/ref-chip:opacity-100 dark:hover:bg-white/15 dark:hover:text-white"
        title="移除参考"
        aria-label="移除参考"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function ReferencePreviewTile({ file, index, stackIndex, onUse, onRemove }: { file: FileVO; index: number; stackIndex: number; onUse: (file: FileVO) => void; onRemove: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  const isImage = file.fileType === "image" || file.mimeType?.startsWith("image/");
  const isVideo = file.fileType === "video" || file.mimeType?.startsWith("video/");
  const title = file.originalName || `参考${index + 1}`;
  const tiltClass = stackIndex % 2 === 0 ? "-rotate-[7deg]" : "rotate-[4deg]";
  const lift = Math.min(stackIndex, 2);

  return (
    <div
      className="group/ref-tile absolute left-0 top-1 overflow-visible hover:z-50"
      style={{ left: lift * 7, top: lift * 3, zIndex: 10 + stackIndex }}
      title={title}
      role="button"
      tabIndex={0}
      onClick={() => onUse(file)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onUse(file);
        }
      }}
    >
      <div className="pointer-events-none absolute -top-11 left-1/2 z-50 max-w-[220px] -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/ref-tile:opacity-100">
        <span className="block max-w-[196px] truncate">{title}</span>
      </div>
      <div className={tiltClass + " relative h-[74px] w-[52px] overflow-hidden rounded-[5px] border border-neutral-200 bg-neutral-100 shadow-sm transition-all duration-200 ease-out group-hover/ref-tile:h-[106px] group-hover/ref-tile:w-[148px] group-hover/ref-tile:rotate-0 group-hover/ref-tile:rounded-2xl group-hover/ref-tile:shadow-[0_18px_44px_rgba(15,23,42,0.20)] dark:border-white/10 dark:bg-white/10"}>
        {isImage && !failed ? (
          <img src={file.fileUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : isVideo ? (
          <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
            <Video className="h-5 w-5" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
            <FileText className="h-5 w-5" />
          </div>
        )}
      </div>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => { event.stopPropagation(); onRemove(file.fileUrl); }}
        className="absolute -right-1.5 -top-1.5 z-50 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white opacity-0 shadow-sm transition-opacity group-hover/ref-tile:opacity-100 dark:bg-white dark:text-neutral-950"
        title="移除参考"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
