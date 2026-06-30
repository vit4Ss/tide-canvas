"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  Clock3,
  Crop,
  Download,
  FolderPlus,
  Image as ImageIcon,
  Languages,
  LayoutGrid,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
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
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import { applyTeamFactor } from "@/lib/points";
import { referenceKindFromFile, referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { FileType, type FileVO } from "@/types/file";
import { toast } from "@/components/shared/toast";

const POLL_INTERVAL = 2000;
const MAX_POLL_IMAGE = 5 * 60 * 1000;
const MAX_POLL_VIDEO = 30 * 60 * 1000;
const MODEL_STORAGE_KEY = "tc:home:modelId";
const IMAGE_REFERENCE_LIMIT = 4;
const VIDEO_REFERENCE_LIMIT = 12;
const IMAGE_RATIO_OPTIONS = ["auto", "1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
const VIDEO_RATIO_OPTIONS = ["auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const IMAGE_QUALITY_OPTIONS = [
  { value: "low", label: "低画质" },
  { value: "standard", label: "标准画质" },
  { value: "high", label: "高画质" },
] as const;
const IMAGE_RESOLUTION_OPTIONS = ["1K", "2K", "4K"];
const VIDEO_RESOLUTION_OPTIONS = ["480P", "720P", "1080P"];
const CREATION_TYPE_OPTIONS = [
  { id: "image", label: "图片生成", icon: ImageIcon },
  { id: "video", label: "视频生成", icon: Video },
] as const;
const VIDEO_REFERENCE_MODE_OPTIONS = [
  { id: "omni", label: "全能参考", icon: Wand2 },
  { id: "firstLast", label: "首尾帧", icon: LayoutGrid },
  { id: "multiFrame", label: "智能多帧", icon: Video },
] as const;
type ReferencePickerTab = "all" | "generated" | "uploaded";
const REFERENCE_PICKER_TABS: { id: ReferencePickerTab; label: string }[] = [
  { id: "all", label: "本地上传" },
  { id: "generated", label: "图片生成器" },
  { id: "uploaded", label: "历史上传" },
] as const;

function fileKey(file: FileVO): string {
  return file.fileUrl || String(file.id);
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
}

function parseModelConfig(model?: AiModelVO): ModelFormatConfig {
  if (!model?.config) return {};
  try {
    return JSON.parse(model.config) as ModelFormatConfig;
  } catch {
    return {};
  }
}

type Tab = "image" | "video";
type GenStatus = "generating" | "done" | "error";
type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number]["value"];
type VideoReferenceMode = (typeof VIDEO_REFERENCE_MODE_OPTIONS)[number]["id"];

interface GenParams {
  prompt: string;
  kind: Tab;
  modelId: string;
  modelName: string;
  ratio: string;
  imageQuality?: ImageQuality;
  imageResolution?: string;
  videoResolution?: string;
  videoDuration?: number;
  videoAudio?: boolean;
  videoReferenceMode?: VideoReferenceMode;
  references?: FileVO[];
  promptReferences?: FileVO[];
}
interface GenResult extends GenParams {
  id: string;
  status: GenStatus;
  url?: string;
  error?: string;
  saved?: boolean;
}

export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { initialized, isLoggedIn, user } = useAuth();
  const [tab, setTab] = useState<Tab>("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const [selectedModelId, setSelectedModelId] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("standard");
  const [imageResolution, setImageResolution] = useState("2K");
  const [videoResolution, setVideoResolution] = useState("720P");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
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
  const [results, setResults] = useState<GenResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ratioButtonRef = useRef<HTMLButtonElement>(null);
  const ratioPanelRef = useRef<HTMLDivElement | null>(null);
  const [ratioPanelStyle, setRatioPanelStyle] = useState<React.CSSProperties>({ left: -9999, top: -9999 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);


  const updateRatioPanelPosition = useCallback(() => {
    const anchor = ratioButtonRef.current;
    if (!anchor) return;
    const gap = 10;
    const margin = 16;
    const minPanelHeight = 220;
    const anchorRect = anchor.getBoundingClientRect();
    const panelWidth = Math.min(372, Math.max(240, window.innerWidth - margin * 2));
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
          (m) => m.type === AiModelType.IMAGE || m.type === AiModelType.VIDEO,
        );
        setModels(usable);
        const saved = typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null;
        const img = usable.find((m) => m.type === AiModelType.IMAGE);
        const restored = saved && usable.find((m) => m.modelId === saved);
        setSelectedModelId((restored ? saved : img?.modelId) ?? usable[0]?.modelId ?? "");
      })
      .catch(() => {});
  }, []);
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

  const tabModels = models.filter((m) =>
    tab === "video" ? m.type === AiModelType.VIDEO : m.type === AiModelType.IMAGE,
  );
  const selectedModel = tabModels.find((m) => m.modelId === selectedModelId) ?? tabModels[0];
  const ratioOptions = tab === "video" ? VIDEO_RATIO_OPTIONS : IMAGE_RATIO_OPTIONS;
  const defaultRatio = tab === "video" ? "16:9" : "1:1";
  const effectiveRatio = ratioOptions.includes(ratio) ? ratio : defaultRatio;
  const ratioForRequest = effectiveRatio === "auto" ? "" : effectiveRatio;
  const referenceLimit = tab === "video" ? VIDEO_REFERENCE_LIMIT : IMAGE_REFERENCE_LIMIT;
  const canUploadReferences = !uploading && references.length < referenceLimit;
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
  const composerPlaceholder = references.length
    ? (tab === "video"
        ? "输入 @ 引用参考素材，描述你想生成的视频"
        : "输入 @ 引用参考图，描述你想生成的图片")
    : (tab === "video"
        ? "输入视频生成的提示词，例如：电影感雨夜街头，镜头缓慢推进"
        : "输入图片生成的提示词，例如：浩瀚的银河中一艘宇宙飞船驶过");
  const uploadLabel = tab === "video" ? "参考内容" : "参考图";
  const referenceMode = VIDEO_REFERENCE_MODE_OPTIONS.find((item) => item.id === videoReferenceMode) ?? VIDEO_REFERENCE_MODE_OPTIONS[0];
  const referenceModeLabel = references.length ? referenceMode.label + " " + references.length : referenceMode.label;
  const modelLabel = selectedModel?.name ?? "暂无可用模型";
  const ReferenceModeIcon = referenceMode.icon;
  const modelSelectable = tabModels.length > 0;
  const busy = results.some((r) => r.status === "generating");
  const hasPromptContent = Boolean(prompt.trim() || promptReferenceFiles.length);
  const canSubmit = hasPromptContent && !busy && !uploading;
  const selectedModelConfig = parseModelConfig(selectedModel);
  const imageMatrixCost = tab === "image" ? selectedModelConfig.pricing?.[imageQuality]?.[imageResolution] : undefined;
  const imageRefCount = references.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).length;
  const videoRefCount = references.filter((file) => file.fileType === "video" || file.mimeType?.startsWith("video/")).length;
  const handlerForCost = tab === "image"
    ? (imageRefCount > 0 ? "image_to_image" : "text_to_image")
    : (imageRefCount > 0 && videoReferenceMode === "firstLast"
        ? "start_end_to_video"
        : (imageRefCount > 0 || videoRefCount > 0 ? "reference_to_video" : "text_to_video"));
  const modelPointCost = selectedModel && selectedModel.pointCost > 0 ? selectedModel.pointCost : undefined;
  const handlerPointCost = handlerCosts[handlerForCost] && handlerCosts[handlerForCost] > 0 ? handlerCosts[handlerForCost] : undefined;
  const basePointCost = imageMatrixCost ?? modelPointCost ?? handlerPointCost ?? (tab === "image" ? 18 : 0);
  const displayPointCost = applyTeamFactor(basePointCost, user);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [results.length]);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = results.length === 0 ? 228 : 168;
    el.style.height = "auto";
    const nextHeight = Math.min(maxHeight, Math.max(86, el.scrollHeight));
    el.style.height = nextHeight + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt, promptReferenceKeys.length, results.length]);
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
    setReferenceModeOpen(false);
    if (next === "image") {
      setReferences((current) => current.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).slice(0, IMAGE_REFERENCE_LIMIT));
    }
    const list = models.filter((m) =>
      next === "video" ? m.type === AiModelType.VIDEO : m.type === AiModelType.IMAGE,
    );
    if (list[0]) setSelectedModelId(list[0].modelId);
  };

  const selectCreationType = (id: (typeof CREATION_TYPE_OPTIONS)[number]["id"]) => {
    if (id === "image" || id === "video") {
      switchTab(id);
      setTypeOpen(false);
      return;
    }
    setTypeOpen(false);
    toast.info("该创作类型暂未开放");
  };

  const selectModel = (id: string) => {
    setSelectedModelId(id);
    setModelOpen(false);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  };

  const patch = (id: string, data: Partial<GenResult>) =>
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const poll = (taskId: number, id: string, maxPoll: number) => {
    let deadline = 0;
    const tick = async () => {
      if (deadline === 0) deadline = Date.now() + maxPoll;
      if (Date.now() > deadline) {
        patch(id, { status: "error", error: t("genTimeout") });
        return;
      }
      try {
        const res = await aiApi.getTask(taskId);
        if (!res.success) {
          patch(id, { status: "error", error: res.message || t("genFailed") });
          return;
        }
        const task = res.data;
        if (task.status === AiTaskStatus.SUCCESS) {
          patch(id, { status: "done", url: task.resultUrl });
        } else if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
          patch(id, { status: "error", error: task.errorMsg || t("genFailed") });
        } else {
          setTimeout(tick, POLL_INTERVAL);
        }
      } catch {
        patch(id, { status: "error", error: t("genFailed") });
      }
    };
    tick();
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
    seqRef.current += 1;
    const id = "g" + seqRef.current;
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
    setResults((rs) => [...rs, { ...p, prompt: text, id, status: "generating" }]);
    const mediaParams = p.kind === "video"
      ? {
          ...(p.videoResolution ? { resolution: p.videoResolution.toLowerCase() } : {}),
          ...(p.videoDuration ? { duration: p.videoDuration } : {}),
          generateAudio: Boolean(p.videoAudio),
        }
      : {
          ...(p.imageQuality ? { quality: p.imageQuality } : {}),
          ...(p.imageResolution ? { resolution: p.imageResolution.toLowerCase() } : {}),
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
    try {
      const res = await aiApi.generate({
        handler,
        modelId: p.modelId,
        input: {
          prompt: text,
          ...(p.ratio ? { aspectRatio: p.ratio, aspect_ratio: p.ratio, ratio: p.ratio } : {}),
          ...mediaParams,
          ...referenceInput,
        },
      });
      if (!res.success) {
        patch(id, { status: "error", error: res.message || t("genFailed") });
        return;
      }
      poll(res.data.id, id, p.kind === "video" ? MAX_POLL_VIDEO : MAX_POLL_IMAGE);
    } catch {
      patch(id, { status: "error", error: t("genFailed") });
    }
  };
  const submit = () => {
    if (!hasPromptContent || busy || uploading) return;
    doGenerate({
      prompt,
      kind: tab,
      modelId: selectedModel?.modelId ?? "",
      modelName: selectedModel?.name ?? "",
      ratio: ratioForRequest,
      imageQuality,
      imageResolution,
      videoResolution,
      videoDuration,
      videoAudio,
      videoReferenceMode,
      references,
      promptReferences: promptReferenceFiles,
    });
    setPrompt("");
    setPromptReferenceKeys([]);
    setReferenceMentionOpen(false);
  };

  const openReferencePicker = () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (!canUploadReferences) {
      toast.error(tab === "video" ? `最多上传 ${VIDEO_REFERENCE_LIMIT} 个参考素材` : `图片生成最多上传 ${IMAGE_REFERENCE_LIMIT} 张参考图`);
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
      if (tab === "image") return file.type.startsWith("image/");
      return file.type.startsWith("image/") || file.type.startsWith("video/");
    });
    if (!accepted.length) {
      toast.error(tab === "image" ? "请拖入图片文件" : "请拖入图片或视频文件");
      return;
    }
    if (accepted.length < picked.length) {
      toast.info(tab === "image" ? "已忽略非图片文件" : "已忽略不支持的文件类型");
    }
    const maxReferences = tab === "video" ? VIDEO_REFERENCE_LIMIT : IMAGE_REFERENCE_LIMIT;
    const selectedInPicker = target === "picker" ? Object.keys(referencePickerSelected).length : 0;
    const usedReferences = references.length + selectedInPicker;
    const available = Math.max(0, maxReferences - usedReferences);
    const files = accepted.slice(0, available);
    if (!files.length) {
      toast.error(tab === "video" ? `最多上传 ${VIDEO_REFERENCE_LIMIT} 个参考素材` : `图片生成最多上传 ${IMAGE_REFERENCE_LIMIT} 张参考图`);
      return;
    }
    if (accepted.length > available) {
      toast.info(tab === "video" ? `最多保留 ${VIDEO_REFERENCE_LIMIT} 个参考素材，已选择前 ${available} 个` : `图片生成最多保留 ${IMAGE_REFERENCE_LIMIT} 张参考图`);
    }
    setUploading(true);
    setUploadProgress(0);
    const uploaded: FileVO[] = [];
    for (const file of files) {
      try {
        const kind = referenceKindFromFile(file);
        const result = await uploadFileSmart(file, (progress) => setUploadProgress(progress), {
          maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
          label: kind === "video" ? "参考视频" : "参考图",
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
      if (target === "picker") {
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
      toast.success(uploaded.length > 1 ? "已上传 " + uploaded.length + " 个参考素材" : "参考素材已上传");
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
    if (file.id < 0) {
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
    if (file.id < 0) {
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
    if (e.key === "Backspace") {
      const atPromptStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
      if (promptReferenceKeys.length && (!prompt || atPromptStart)) {
        e.preventDefault();
        setReferenceMentionOpen(false);
        setPromptReferenceKeys((current) => current.slice(0, -1));
        window.requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
    }
    if (e.key === "@") {
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

  const download = async (r: GenResult) => {
    if (!r.url) return;
    const ext = r.kind === "video" ? "mp4" : "png";
    try {
      const resp = await fetch(r.url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = "tidecanvas-" + r.id + "." + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(r.url, "_blank", "noopener");
    }
  };

  const saveToLibrary = async (r: GenResult, thenOpenCanvas = false) => {
    if (!r.url) return;
    try {
      const res = await fileApi.saveFromUrl({ url: r.url, fileType: r.kind, originalName: r.prompt.slice(0, 40) });
      if (res.success) {
        patch(r.id, { saved: true });
        toast.success(thenOpenCanvas ? t("savedToCanvas") : t("savedToLibrary"));
        if (thenOpenCanvas) window.open("/canvas/new", "_blank", "noopener");
      } else {
        toast.error(res.message || t("saveFailed"));
      }
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  return (
    <>
      <section className="relative z-30 flex min-h-screen flex-col overflow-hidden bg-[#f7f8fa] px-4 pt-14 text-neutral-950 sm:px-6 lg:px-8 dark:bg-[#101114] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[linear-gradient(to_bottom,#f3f5f8,rgba(247,248,250,0.9)_64%,#f7f8fa)] dark:bg-[linear-gradient(to_bottom,#17181d,rgba(16,17,20,0.92)_64%,#101114)]" />

      <div className={(results.length === 0
        ? "mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-[1120px] flex-col justify-center pb-[10vh] pt-8"
        : "mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1280px] flex-col")}>
        <div className={(results.length === 0 ? "px-1" : "min-h-0 flex-1 px-1 pt-8 sm:pt-12")}>
          {results.length === 0 ? null : (
            <div className="mx-auto w-full max-w-[900px] space-y-5 pb-8 pt-4 text-left">
              {results.map((r) => (
                <div key={r.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[78%] rounded-3xl rounded-br-lg bg-neutral-950 px-4 py-3 text-sm leading-6 text-white shadow-[0_10px_28px_rgba(15,23,42,0.14)] dark:bg-white dark:text-neutral-950">
                      {r.prompt}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-3xl rounded-bl-lg bg-white/88 p-3 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/8 dark:ring-white/10">
                      <div className="flex flex-wrap items-center gap-2 px-1 pb-3 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 dark:bg-white/8">
                          {r.kind === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          {r.modelName || t("model")}
                        </span>
                        {r.ratio && (
                          <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 dark:bg-white/8">
                            <Crop className="h-3 w-3" />
                            {r.ratio}
                          </span>
                        )}
                      </div>

                      {r.status === "generating" && (
                        <div className="flex h-44 w-[360px] max-w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 text-sm text-neutral-400 dark:border-white/10 dark:bg-white/5">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("generating")}
                        </div>
                      )}
                      {r.status === "done" && r.url && (
                        r.kind === "video" ? (
                          <video src={r.url} controls className="max-h-96 w-auto max-w-full rounded-2xl border border-neutral-200 dark:border-white/10" />
                        ) : (
                          <img src={r.url} alt={r.prompt} className="max-h-96 w-auto max-w-full rounded-2xl border border-neutral-200 dark:border-white/10" />
                        )
                      )}
                      {r.status === "error" && <p className="px-1 py-3 text-sm text-red-500">生成失败</p>}

                      {r.status === "done" && r.url && (
                        <div className="mt-3 flex flex-wrap gap-2 px-1">
                          <ActionBtn onClick={() => doGenerate(r)} icon={<RefreshCw className="h-3.5 w-3.5" />} label={t("regenerate")} />
                          <ActionBtn onClick={() => download(r)} icon={<Download className="h-3.5 w-3.5" />} label={t("download")} />
                          <ActionBtn onClick={() => saveToLibrary(r, true)} icon={<LayoutGrid className="h-3.5 w-3.5" />} label={t("saveToCanvas")} />
                          <ActionBtn
                            onClick={() => saveToLibrary(r)}
                            disabled={r.saved}
                            icon={r.saved ? <Check className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
                            label={r.saved ? t("added") : t("addToLibrary")}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>
        <div className={(results.length === 0
          ? "relative z-40 px-0 pb-0 pt-0"
          : "sticky bottom-4 z-40 -mx-4 bg-[linear-gradient(to_top,#f7f8fa_74%,rgba(247,248,250,0))] px-4 pb-0 pt-3 sm:-mx-6 sm:px-6 dark:bg-[linear-gradient(to_top,#101114_74%,rgba(16,17,20,0))]")}> 
          <div className={(results.length === 0 ? "mx-auto w-full max-w-[920px]" : "mx-auto w-full max-w-[960px]")}> 
            <div
              data-type-open={typeOpen ? "true" : undefined}
              className="relative z-30 rounded-xl border border-black/[0.06] bg-white p-3 text-left shadow-[0_18px_42px_rgba(15,23,42,0.14)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1d1e23]"
            >
              <input ref={fileInputRef} type="file" multiple={referenceLimit > 1} accept={tab === "video" ? "image/*,video/*" : "image/*"} className="hidden" onChange={handleReferenceChange} />

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
                      const supported = item.id === "image" || item.id === "video";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => { setTypeOpen(false); selectCreationType(item.id); }}
                          className={(active
                            ? "bg-blue-50 text-[#1268ff]"
                            : supported
                              ? "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white"
                              : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white") +
                            " flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors"}
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white"
                    title="展开"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="relative mt-2 flex min-h-[86px] w-full flex-wrap content-start items-start gap-1.5"
                  onClick={() => textareaRef.current?.focus()}
                >
                  {promptReferenceFiles.map((file) => {
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
                    onDoubleClick={handlePromptDoubleClick}
                    placeholder={promptReferenceFiles.length ? "" : composerPlaceholder}
                    rows={2}
                    style={{ outline: "none", boxShadow: "none", border: "none" }}
                    className="prompt-scroll block min-h-[44px] min-w-[220px] flex-1 resize-none border-0 bg-transparent px-0 text-[14px] leading-6 text-neutral-800 placeholder:text-neutral-400 outline-none transition-[height] duration-150 ease-out focus:outline-none focus:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  />
                  {referenceMentionOpen && references.length > 0 && (
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
                  {references.length === 0 ? (
                    <button
                      type="button"
                      onClick={openReferencePicker}
                      disabled={!canUploadReferences}
                      className={(referenceDragActive
                        ? "border-[#00a7d7] bg-sky-50 text-[#00a7d7] ring-2 ring-[#00a7d7]/35 dark:bg-sky-400/10 dark:text-[#43c9ef]"
                        : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-white/10 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/12") +
                        " flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"}
                      title={tab === "video" ? "点击或拖拽上传参考素材" : "点击或拖拽上传参考图"}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      <span className="text-[11px] font-medium leading-none">{tab === "video" ? "素材" : "图片"}</span>
                    </button>
                  ) : (
                    <div className="relative h-[74px] w-[82px] shrink-0 overflow-visible">
                      {references.slice(0, 3).map((file, index) => (
                        <ReferencePreviewTile key={fileKey(file)} file={file} index={index} stackIndex={index} onUse={addPromptReference} onRemove={removeReference} />
                      ))}
                      {references.length > 3 && (
                        <span className="absolute left-[46px] top-[7px] z-30 flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-950 px-1 text-[10px] font-semibold text-white shadow-sm dark:bg-white dark:text-neutral-950">
                          +{references.length - 3}
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
                      onClick={() => { if (!tabModels.length) return; setModelOpen((o) => !o); setTypeOpen(false); setRatioOpen(false); setReferenceModeOpen(false); }}
                      className={(modelSelectable ? "text-neutral-800 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-white/12" : "cursor-default text-neutral-400 dark:text-neutral-500") + " flex h-9 max-w-[240px] items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium ring-1 ring-black/[0.12] transition-colors dark:bg-white/8 dark:ring-white/10"}
                    >
                      <Box className="h-3.5 w-3.5" />
                      <span className="truncate">{modelLabel}</span>
                      {modelSelectable && <ChevronDown className={(modelOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />}
                    </button>
                    {modelOpen && modelSelectable && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-3 max-h-72 w-64 overflow-auto rounded-xl bg-white p-1 shadow-xl ring-1 ring-black/10 dark:bg-[#25262b] dark:ring-white/10">
                          {tabModels.map((m) => (
                            <button
                              key={m.modelId}
                              type="button"
                              onClick={() => selectModel(m.modelId)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/8"
                            >
                              <span className="flex-1 truncate text-left">{m.name}</span>
                              {m.modelId === selectedModelId && <Check className="h-4 w-4 shrink-0 text-neutral-900 dark:text-white" />}
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
                        onClick={() => { setReferenceModeOpen((open) => !open); setTypeOpen(false); setModelOpen(false); setRatioOpen(false); }}
                        className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-neutral-800 ring-1 ring-black/[0.12] transition-colors hover:bg-neutral-50 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
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
                                    " flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm transition-colors"}
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

                  <div className="relative min-w-0">
                    <button
                      ref={ratioButtonRef}
                      type="button"
                      onClick={() => { setRatioOpen((o) => !o); setTypeOpen(false); setModelOpen(false); setReferenceModeOpen(false); }}
                      className="flex h-9 max-w-[280px] items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-neutral-800 ring-1 ring-black/[0.12] transition-colors hover:bg-neutral-50 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span className="truncate">{effectiveRatio === "auto" ? "智能比例" : effectiveRatio}</span>
                      <span className="h-4 w-px bg-neutral-200 dark:bg-white/10" />
                      <span>{tab === "video" ? videoResolution : "1张"}</span>
                      <ChevronDown className={(ratioOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                    </button>
                    {ratioOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setRatioOpen(false)} />
                        <div
                          ref={ratioPanelRef}
                          className="absolute z-50 rounded-lg border border-black/[0.06] bg-white p-3 text-left shadow-[0_22px_70px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#25262b] dark:shadow-black/35"
                          style={ratioPanelStyle}
                        >
                          {tab === "video" ? (
                            <VideoParamPanel
                              ratio={effectiveRatio}
                              onRatioChange={setRatio}
                              resolution={videoResolution}
                              onResolutionChange={setVideoResolution}
                              duration={videoDuration}
                              onDurationChange={setVideoDuration}
                              audio={videoAudio}
                              onAudioChange={setVideoAudio}
                            />
                          ) : (
                            <ImageParamPanel
                              ratio={effectiveRatio}
                              onRatioChange={setRatio}
                              quality={imageQuality}
                              onQualityChange={setImageQuality}
                              resolution={imageResolution}
                              onResolutionChange={setImageResolution}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {tab === "video" && (
                    <button
                      type="button"
                      onClick={() => setVideoDuration((value) => (value === 5 ? 10 : 5))}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-neutral-800 ring-1 ring-black/[0.12] transition-colors hover:bg-neutral-50 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <Clock3 className="h-3.5 w-3.5" />
                      {videoDuration}s
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => toast.info("翻译优化暂未开放")}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-neutral-800 ring-1 ring-black/[0.12] transition-colors hover:bg-neutral-50 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    title="翻译优化"
                  >
                    <Languages className="h-4 w-4" />
                  </button>
                </div>

                <div className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-1 ring-1 ring-black/[0.05] dark:bg-white/10 dark:ring-white/10">
                  <span className={(canSubmit
                    ? "text-neutral-700 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-white/50") +
                    " flex h-7 items-center gap-1 rounded-md px-2.5 text-sm font-semibold"}
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
  const generated = file.id < 0;
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
          // eslint-disable-next-line @next/next/no-img-element
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
                ? "bg-blue-50 text-[#1268ff] dark:bg-blue-500/15 dark:text-blue-200"
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
            <ImageIcon className="h-5 w-5" />
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
function ImageParamPanel({
  ratio,
  onRatioChange,
  quality,
  onQualityChange,
  resolution,
  onResolutionChange,
}: {
  ratio: string;
  onRatioChange: (value: string) => void;
  quality: ImageQuality;
  onQualityChange: (value: ImageQuality) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
}) {
  return (
    <div>
      <ParamSection title="图像质量">
        <SegmentedRow count={IMAGE_QUALITY_OPTIONS.length}>
          {IMAGE_QUALITY_OPTIONS.map((item) => (
            <SegmentButton key={item.value} active={quality === item.value} onClick={() => onQualityChange(item.value)}>
              {item.label}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="清晰度">
        <SegmentedRow count={IMAGE_RESOLUTION_OPTIONS.length}>
          {IMAGE_RESOLUTION_OPTIONS.map((item) => (
            <SegmentButton key={item} active={resolution === item} onClick={() => onResolutionChange(item)}>
              {item}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="图片尺寸">
        <div className="grid grid-cols-6 gap-x-1 gap-y-2 rounded-lg bg-neutral-100 p-2 dark:bg-white/8">
          {IMAGE_RATIO_OPTIONS.map((item) => (
            <RatioTile key={item} value={item} active={ratio === item} onClick={() => onRatioChange(item)} />
          ))}
        </div>
      </ParamSection>
    </div>
  );
}

function VideoParamPanel({
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  duration,
  onDurationChange,
  audio,
  onAudioChange,
}: {
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  audio: boolean;
  onAudioChange: (value: boolean) => void;
}) {
  return (
    <div>
      <ParamSection title="视频尺寸">
        <div className="grid grid-cols-6 gap-x-1 gap-y-2 rounded-lg bg-neutral-100 p-2 dark:bg-white/8">
          {VIDEO_RATIO_OPTIONS.map((item) => (
            <RatioTile key={item} value={item} active={ratio === item} onClick={() => onRatioChange(item)} />
          ))}
        </div>
      </ParamSection>
      <ParamSection title="清晰度">
        <SegmentedRow count={VIDEO_RESOLUTION_OPTIONS.length}>
          {VIDEO_RESOLUTION_OPTIONS.map((item) => (
            <SegmentButton key={item} active={resolution === item} onClick={() => onResolutionChange(item)}>
              {item}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="视频时长">
        <SegmentedRow count={2}>
          <SegmentButton active={duration === 5} onClick={() => onDurationChange(5)}>5s</SegmentButton>
          <SegmentButton active={duration === 10} onClick={() => onDurationChange(10)}>10s</SegmentButton>
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="生成音频">
        <SegmentedRow count={2}>
          <SegmentButton active={audio} onClick={() => onAudioChange(true)}>开启</SegmentButton>
          <SegmentButton active={!audio} onClick={() => onAudioChange(false)}>关闭</SegmentButton>
        </SegmentedRow>
      </ParamSection>
    </div>
  );
}

function ParamSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="not-first:mt-4">
      <div className="mb-2 text-[14px] font-semibold leading-5 text-neutral-700 dark:text-neutral-200">{title}</div>
      {children}
    </section>
  );
}

function SegmentedRow({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="grid rounded-lg bg-neutral-100 p-1 dark:bg-white/8" style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={(active
        ? "bg-white text-neutral-950 shadow-sm dark:bg-white dark:text-neutral-950"
        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white") +
        " flex h-9 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors"}
    >
      {children}
    </button>
  );
}

function RatioTile({ value, active, onClick }: { value: string; active: boolean; onClick: () => void }) {
  const label = value === "auto" ? "智能比例" : value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={(active
        ? "bg-white text-neutral-950 shadow-sm dark:bg-white dark:text-neutral-950"
        : "text-neutral-500 hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white") +
        " flex h-[50px] flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors"}
    >
      <RatioShape value={value} />
      <span className="leading-none">{label}</span>
    </button>
  );
}

function RatioShape({ value }: { value: string }) {
  if (value === "auto") {
    return <span className="h-4 w-4 rounded-[2px] border border-current" />;
  }
  const [wRaw, hRaw] = value.split(":").map((part) => Number(part));
  const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1;
  const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 1;
  const max = 18;
  let width = max;
  let height = max;
  if (w >= h) {
    height = Math.max(4, Math.round((h / w) * max));
  } else {
    width = Math.max(4, Math.round((w / h) * max));
  }
  return <span className="rounded-[2px] border border-current" style={{ width, height }} />;
}
function ActionBtn({ onClick, icon, label, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/12"
    >
      {icon}
      {label}
    </button>
  );
}
