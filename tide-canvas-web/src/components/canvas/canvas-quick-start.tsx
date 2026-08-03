"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import { SkillPicker } from "@/components/skill/skill-picker";
import { toast } from "@/components/shared/toast";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { createNode } from "@/lib/canvas-helpers";
import { aiApi, uploadFileSmart } from "@/lib/api";
import {
  CHARACTER_NODE_TYPE,
  isConceptCanvasNodeType,
  isImageReferenceNodeType,
} from "@/lib/canvas-node-types";
import { parseSkillParams } from "@/lib/skill-api";
import {
  referenceKindFromFile,
  resolveModelReferenceLimitBytes,
  validateKnownFileSize,
} from "@/lib/upload-limits";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore, type CanvasNode, type Connection } from "@/stores/use-canvas-store";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { FileType, type FileVO } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import { ModelPicker } from "./nodes/model-picker";
import { PromptRefEditor } from "./nodes/prompt-ref-editor";
import { inlineTextRefs, refLabel, type RefItem, type RefKind } from "./nodes/prompt-ref-utils";
import { RATIO_OPTIONS } from "./nodes/quality-ratio-picker";
import { parseModelConfig, validateReferenceFileSizes } from "./nodes/shared/node-utils";
import { normalizeDurations, VIDEO_RATIOS } from "./nodes/video-param-picker";
import { CANVAS_ASSISTANT_VISIBILITY_EVENT } from "./canvas-assistant-panel";
import styles from "./styles/canvas-quick-start.module.css";

type QuickStartMode = "image" | "video";

interface Props {
  getViewportCenter: () => { x: number; y: number };
}

interface QuickRef extends RefItem {
  sourceNodeId?: string;
  file?: FileVO;
  textContent?: string;
  isConcept?: boolean;
}

interface QuickModelConfig {
  ratios?: string[];
  qualities?: string[];
  clarities?: string[];
  resolutions?: string[];
  durations?: Array<string | number>;
  audio?: boolean;
  batchSizes?: number[];
  gridOutput?: boolean;
}

const DEFAULT_IMAGE_RATIOS = RATIO_OPTIONS.map((option) => option.value);
const DEFAULT_VIDEO_RATIOS = VIDEO_RATIOS.map((option) => option.value);
const MAX_QUICK_ATTACHMENTS = 8;

function supportsHandler(model: AiModelVO, handler: string) {
  return !model.supportedHandlers?.length || model.supportedHandlers.includes(handler);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

function durationArray(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string | number =>
    (typeof item === "number" && Number.isFinite(item)) || typeof item === "string",
  );
}

function safeModelConfig(model?: AiModelVO): QuickModelConfig {
  const raw = parseModelConfig<Record<string, unknown>>(model);
  return {
    ratios: stringArray(raw.ratios),
    qualities: stringArray(raw.qualities),
    clarities: stringArray(raw.clarities),
    resolutions: stringArray(raw.resolutions),
    durations: durationArray(raw.durations),
    ...(typeof raw.audio === "boolean" ? { audio: raw.audio } : {}),
    ...(typeof raw.gridOutput === "boolean" ? { gridOutput: raw.gridOutput } : {}),
  };
}

function tokenPattern(label: string) {
  return new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g");
}

function containsRef(prompt: string, ref: RefItem) {
  return tokenPattern(refLabel(ref)).test(prompt);
}

function pushQuickRef(
  target: QuickRef[],
  counters: Record<RefKind, number>,
  ref: Omit<QuickRef, "index"> & { kind: RefKind },
) {
  counters[ref.kind] += 1;
  target.push({ ...ref, index: counters[ref.kind] });
}

function buildQuickRefs(nodes: CanvasNode[], attachments: FileVO[]): QuickRef[] {
  const refs: QuickRef[] = [];
  const counters: Record<RefKind, number> = { image: 0, video: 0, audio: 0, text: 0 };

  for (const node of nodes) {
    if (isImageReferenceNodeType(node.type) && node.imageSrc) {
      pushQuickRef(refs, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: node.imageSrc,
        src: node.imageSrc,
        title: node.title || "画布图片",
        kind: "image",
        isConcept: isConceptCanvasNodeType(node.type),
      });
      continue;
    }
    if (node.type === "video" && node.videoSrc) {
      pushQuickRef(refs, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: "",
        src: node.videoSrc,
        title: node.title || "画布视频",
        kind: "video",
      });
      continue;
    }
    const text = node.type === "text"
      ? node.content?.trim()
      : isConceptCanvasNodeType(node.type)
        ? node.prompt?.trim()
        : "";
    if (text) {
      pushQuickRef(refs, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: "",
        title: node.title || "画布文本",
        text,
        textContent: text,
        kind: "text",
        isConcept: isConceptCanvasNodeType(node.type),
      });
    }
  }

  for (const file of attachments) {
    if (file.fileType === FileType.IMAGE) {
      pushQuickRef(refs, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: file.fileUrl,
        src: file.fileUrl,
        title: file.originalName,
        kind: "image",
      });
    } else if (file.fileType === FileType.VIDEO) {
      pushQuickRef(refs, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: "",
        src: file.fileUrl,
        title: file.originalName,
        kind: "video",
      });
    }
  }
  return refs;
}

/** 用稳定 id 做两阶段替换，避免「图片1 → 图片2」后又被下一条规则二次命中。 */
function remapPromptRefs(prompt: string, previous: QuickRef[], next: QuickRef[]) {
  let value = prompt;
  const sentinels = new Map<string, string>();
  previous.forEach((ref, index) => {
    const sentinel = `__QS_REF_${index}_${Date.now()}__`;
    sentinels.set(ref.id, sentinel);
    value = value.replace(tokenPattern(refLabel(ref)), sentinel);
  });
  for (const [id, sentinel] of sentinels) {
    const replacement = next.find((ref) => ref.id === id);
    value = value.replaceAll(sentinel, replacement ? refLabel(replacement) : "");
  }
  return value.replace(/[ \t]{2,}/g, " ");
}

function compactPromptRefs(prompt: string, usedRefs: QuickRef[]) {
  let value = prompt;
  const byKind: Record<RefKind, QuickRef[]> = { image: [], video: [], audio: [], text: [] };
  for (const ref of usedRefs) byKind[ref.kind ?? "image"].push(ref);
  const sentinels: Array<{ sentinel: string; nextLabel: string }> = [];
  for (const kind of ["image", "video", "audio", "text"] as const) {
    byKind[kind].forEach((ref, index) => {
      const sentinel = `__QS_USED_${kind}_${index}_${Date.now()}__`;
      value = value.replace(tokenPattern(refLabel(ref)), sentinel);
      const prefix = kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
      sentinels.push({ sentinel, nextLabel: `${prefix}${index + 1}` });
    });
  }
  for (const item of sentinels) value = value.replaceAll(item.sentinel, item.nextLabel);
  return value;
}

function compactRefLabel(ref: QuickRef, usedRefs: QuickRef[]) {
  const kind = ref.kind ?? "image";
  const index = usedRefs.filter((item) => (item.kind ?? "image") === kind).findIndex((item) => item.id === ref.id);
  const prefix = kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
  return index >= 0 ? `${prefix}${index + 1}` : "";
}

/** 概念节点没有图片时只靠连接注入角色/场景设定，节点正文里不保留悬空的「文本N」。 */
function promptForConnectedNode(prompt: string, usedRefs: QuickRef[]) {
  let value = compactPromptRefs(prompt, usedRefs);
  for (const ref of usedRefs) {
    if (!ref.isConcept || ref.kind !== "text") continue;
    const label = compactRefLabel(ref, usedRefs);
    if (label) value = value.replace(tokenPattern(label), "");
  }
  return value.replace(/[ \t]{2,}/g, " ").trim();
}

function optionValue(value: string, options: string[], fallback: string) {
  if (options.includes(value)) return value;
  const caseInsensitive = options.find((option) => option.toLowerCase() === value.toLowerCase());
  return caseInsensitive ?? options[0] ?? fallback;
}

function QuickSelect({ label, value, options, onChange, disabled, formatOption }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  formatOption?: (value: string) => string;
}) {
  return (
    <label className={styles.selectControl} title={label}>
      <span className={styles.controlLabel}>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length === 0
          ? <option value={value}>模型默认</option>
          : options.map((option) => <option key={option} value={option}>{formatOption?.(option) ?? option}</option>)}
      </select>
      <ChevronDown aria-hidden className={styles.chevron} />
    </label>
  );
}

export function CanvasQuickStart({ getViewportCenter }: Props) {
  const user = useAuthStore((state) => state.user);
  const referenceSignature = useCanvasStore((state) => JSON.stringify(state.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    prompt: node.prompt,
    content: node.content,
    imageSrc: node.imageSrc,
    videoSrc: node.videoSrc,
    fileSize: node.fileSize,
    fileType: node.fileType,
    mimeType: node.mimeType,
  }))));
  const projectId = useCanvasStore((state) => state.currentProjectId);
  const referenceNodes = useMemo(() => {
    void referenceSignature;
    return useCanvasStore.getState().nodes;
  }, [referenceSignature]);
  const { generate } = useAiGeneration();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<QuickStartMode>("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillVO | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<FileVO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [canvasMode, setCanvasMode] = useState(true);
  const [refMenuOpen, setRefMenuOpen] = useState(false);
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQuality, setImageQuality] = useState("standard");
  const [imageResolution, setImageResolution] = useState("2K");
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("720P");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptValueRef = useRef(prompt);
  const refMenuWrapRef = useRef<HTMLDivElement>(null);
  const refMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const refMenuPanelRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const projectEpochRef = useRef(0);
  const optimizeSeqRef = useRef(0);
  const uploadSeqRef = useRef(0);
  const lastProjectIdRef = useRef<string | null>(null);
  const previousRefsRef = useRef<{ projectId: string | null; refs: QuickRef[] }>({ projectId: null, refs: [] });
  const [refMenuPosition, setRefMenuPosition] = useState({ left: 12, top: 12, openUp: false });

  useEffect(() => {
    promptValueRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    let active = true;
    void aiApi.listModels()
      .then((result) => {
        if (active && result.success) setModels(result.data ?? []);
      })
      .catch(() => {
        if (active) setModels([]);
      })
      .finally(() => {
        if (active) setModelsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleAssistantVisibility = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ open?: boolean }>;
      if (!event.detail?.open) return;
      setExpanded(false);
      setRefMenuOpen(false);
      setSkillPickerOpen(false);
    };
    window.addEventListener(CANVAS_ASSISTANT_VISIBILITY_EVENT, handleAssistantVisibility);
    return () => window.removeEventListener(CANVAS_ASSISTANT_VISIBILITY_EVENT, handleAssistantVisibility);
  }, []);

  useEffect(() => {
    if (!refMenuOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      refMenuPanelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (refMenuWrapRef.current?.contains(target) || refMenuPanelRef.current?.contains(target))
      ) return;
      setRefMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setRefMenuOpen(false);
    };
    const closeOnViewportChange = () => setRefMenuOpen(false);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [refMenuOpen]);

  const quickRefs = useMemo(() => buildQuickRefs(referenceNodes, attachments), [attachments, referenceNodes]);

  useEffect(() => {
    if (lastProjectIdRef.current === projectId) return;
    lastProjectIdRef.current = projectId;
    projectEpochRef.current += 1;
    optimizeSeqRef.current += 1;
    uploadSeqRef.current += 1;
    submitLockRef.current = false;
    previousRefsRef.current = { projectId, refs: quickRefs };
    const frame = requestAnimationFrame(() => {
      if (useCanvasStore.getState().currentProjectId !== projectId) return;
      setPrompt("");
      setAttachments([]);
      setSelectedSkill(null);
      setSelectedModelId("");
      setSkillPickerOpen(false);
      setRefMenuOpen(false);
      setUploading(false);
      setUploadProgress(0);
      setOptimizing(false);
      setSubmitting(false);
      setExpanded(useCanvasStore.getState().nodes.length === 0);
    });
    return () => cancelAnimationFrame(frame);
    // quickRefs is deliberately excluded: this reset is scoped to a project epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const previous = previousRefsRef.current;
    if (previous.projectId !== projectId) {
      previousRefsRef.current = { projectId, refs: quickRefs };
      return;
    }
    const before = previous.refs.map((ref) => `${ref.id}:${ref.kind}:${ref.index}`).join("|");
    const after = quickRefs.map((ref) => `${ref.id}:${ref.kind}:${ref.index}`).join("|");
    previousRefsRef.current = { projectId, refs: quickRefs };
    if (before === after) return;
    setPrompt((current) => remapPromptRefs(current, previous.refs, quickRefs));
  }, [projectId, quickRefs]);

  const usedRefs = useMemo(
    () => quickRefs.filter((ref) => !!ref.file || containsRef(prompt, ref)),
    [prompt, quickRefs],
  );
  const modelType = mode === "image" ? AiModelType.IMAGE : AiModelType.VIDEO;
  const typeModels = models.filter((model) => model.type === modelType);
  const imageRefCount = usedRefs.filter((ref) => ref.kind === "image").length;
  const videoRefCount = usedRefs.filter((ref) => ref.kind === "video").length;
  const preferredHandler = mode === "image"
    ? imageRefCount > 0 ? "image_to_image" : "text_to_image"
    : videoRefCount > 0 || imageRefCount > 1
      ? "reference_to_video"
      : imageRefCount === 1
        ? "image_to_video"
        : "text_to_video";
  const handler = preferredHandler === "image_to_video" && !typeModels.some((model) => supportsHandler(model, preferredHandler))
    && typeModels.some((model) => supportsHandler(model, "reference_to_video"))
    ? "reference_to_video"
    : preferredHandler;
  const compatibleModels = typeModels.filter((model) => supportsHandler(model, handler));
  const selectedModel = compatibleModels.find((model) => model.modelId === selectedModelId)
    ?? compatibleModels.find((model) => model.modelId === selectedSkill?.modelId)
    ?? compatibleModels[0];
  const modelConfig = safeModelConfig(selectedModel);

  const ratioOptions = mode === "image"
    ? modelConfig.ratios ?? DEFAULT_IMAGE_RATIOS
    : modelConfig.ratios ?? DEFAULT_VIDEO_RATIOS;
  const activeRatio = optionValue(mode === "image" ? imageRatio : videoRatio, ratioOptions, "auto");
  const qualityOptions = modelConfig.qualities ?? ["standard"];
  const activeQuality = optionValue(imageQuality, qualityOptions, "standard");
  const resolutionOptions = mode === "image"
    ? modelConfig.clarities ?? modelConfig.resolutions ?? ["2K"]
    : modelConfig.resolutions ?? ["720P"];
  const activeResolution = optionValue(mode === "image" ? imageResolution : videoResolution, resolutionOptions, mode === "image" ? "2K" : "720P");
  const durationOptions = normalizeDurations(modelConfig.durations);
  const activeDuration = durationOptions.includes(videoDuration) ? videoDuration : durationOptions[0] ?? videoDuration;
  const activeRefCount = usedRefs.length;

  const toggleRefMenu = () => {
    if (refMenuOpen) {
      setRefMenuOpen(false);
      return;
    }
    const rect = refMenuTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelWidth = 286;
    const panelHeight = 288;
    const openUp = window.innerHeight - rect.bottom < panelHeight + 20 && rect.top > window.innerHeight - rect.bottom;
    setRefMenuPosition({
      left: Math.min(Math.max(10, rect.left), Math.max(10, window.innerWidth - panelWidth - 10)),
      top: openUp ? rect.top - 8 : rect.bottom + 8,
      openUp,
    });
    setRefMenuOpen(true);
  };

  const handleRefMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!refMenuPanelRef.current) return;
    const items = Array.from(refMenuPanelRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  const switchMode = (nextMode: QuickStartMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setSelectedModelId("");
    setSelectedSkill(null);
    setRefMenuOpen(false);
    optimizeSeqRef.current += 1;
  };

  const pickSkill = (skill: SkillVO) => {
    setSelectedSkill(skill);
    setSkillPickerOpen(false);
    if (skill.modelId) setSelectedModelId(skill.modelId);
    const defaults = parseSkillParams(skill.defaultParams);
    if (defaults.aspectRatio) {
      if (mode === "image") setImageRatio(defaults.aspectRatio);
      else setVideoRatio(defaults.aspectRatio);
    }
    if (defaults.resolution) {
      if (mode === "image") setImageResolution(defaults.resolution);
      else setVideoResolution(defaults.resolution);
    }
    if (defaults.quality) setImageQuality(defaults.quality);
    if (defaults.duration) setVideoDuration(defaults.duration);
  };

  const removeAttachment = (fileId: string) => {
    setAttachments((current) => current.filter((file) => file.id !== fileId));
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || uploading) return;
    if (!projectId) {
      toast.info("画布仍在加载，请稍后再添加参考素材");
      return;
    }
    const uploadSeq = ++uploadSeqRef.current;
    const projectEpoch = projectEpochRef.current;
    const launchProjectId = projectId;
    const isCurrent = () =>
      uploadSeq === uploadSeqRef.current &&
      projectEpoch === projectEpochRef.current &&
      useCanvasStore.getState().currentProjectId === launchProjectId;
    const remaining = Math.max(0, MAX_QUICK_ATTACHMENTS - attachments.length);
    if (remaining === 0) {
      toast.info(`快速开始最多添加 ${MAX_QUICK_ATTACHMENTS} 个参考素材`);
      return;
    }
    const accepted = files
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .slice(0, remaining);
    if (accepted.length !== files.length) toast.info("快速开始当前仅支持图片和视频参考");
    if (!accepted.length) return;

    setUploading(true);
    setUploadProgress(0);
    const uploaded: FileVO[] = [];
    for (const file of accepted) {
      try {
        const kind = referenceKindFromFile(file);
        const result = await uploadFileSmart(file, (progress) => {
          if (isCurrent()) setUploadProgress(progress);
        }, {
          maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
          label: kind === "video" ? "参考视频" : "参考图片",
        });
        if (!isCurrent()) return;
        if (result.success && result.data) uploaded.push(result.data);
        else toast.error(result.message || `上传失败：${file.name}`);
      } catch (error) {
        if (isCurrent()) toast.error((error as Error)?.message || `上传失败：${file.name}`);
      }
    }
    if (isCurrent() && uploaded.length) {
      setAttachments((current) => [...current, ...uploaded]);
      toast.success(uploaded.length > 1 ? `已添加 ${uploaded.length} 个参考素材` : "参考素材已添加");
    }
    if (isCurrent()) {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const optimizePrompt = async () => {
    const value = prompt.trim();
    if (!value || optimizing) return;
    const optimizeSeq = ++optimizeSeqRef.current;
    const projectEpoch = projectEpochRef.current;
    const launchProjectId = projectId;
    setOptimizing(true);
    try {
      const result = await aiApi.optimizePrompt(value);
      const isCurrent =
        optimizeSeq === optimizeSeqRef.current &&
        projectEpoch === projectEpochRef.current &&
        useCanvasStore.getState().currentProjectId === launchProjectId;
      if (!isCurrent) return;
      if (result.success && result.data?.prompt) {
        if (promptValueRef.current.trim() === value) {
          setPrompt(result.data.prompt);
          toast.success("提示词已优化");
        }
      } else {
        toast.error(result.message || "优化失败");
      }
    } catch (error) {
      if (optimizeSeq === optimizeSeqRef.current && projectEpoch === projectEpochRef.current) {
        toast.error((error as Error)?.message || "优化失败");
      }
    } finally {
      if (optimizeSeq === optimizeSeqRef.current && projectEpoch === projectEpochRef.current) {
        setOptimizing(false);
      }
    }
  };

  const submit = async () => {
    if (submitLockRef.current || submitting) return;
    if (uploading) {
      toast.info("参考素材仍在上传，请稍候");
      return;
    }
    if (optimizing) {
      toast.info("提示词仍在优化，请稍候");
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.info("先描述你想创作的内容");
      return;
    }
    if (!projectId) {
      toast.info("画布仍在加载，请稍后再试");
      return;
    }
    if (!selectedModel) {
      toast.error(modelsLoaded ? "没有支持当前生成方式的模型" : "模型正在加载");
      return;
    }
    const pinnedSkillModel = selectedSkill?.modelId
      ? models.find((model) => model.modelId === selectedSkill.modelId)
      : undefined;
    if (canvasMode && pinnedSkillModel && !supportsHandler(pinnedSkillModel, handler)) {
      toast.info("当前 Skill 指定的模型不支持这些参考素材，请移除引用或更换 Skill");
      return;
    }
    if (mode === "image" && usedRefs.some((ref) => ref.kind === "video")) {
      toast.info("图片创作暂不支持视频参考，请切到短剧 Agent 或移除视频引用");
      return;
    }

    const state = useCanvasStore.getState();
    const existingSources = usedRefs
      .flatMap((ref) => ref.sourceNodeId ? state.nodes.filter((node) => node.id === ref.sourceNodeId) : []);
    if (!validateReferenceFileSizes(existingSources, selectedModel)) return;
    for (const ref of usedRefs) {
      if (!ref.file) continue;
      const message = validateKnownFileSize(ref.file.fileSize, ref.file.originalName, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, ref.kind === "video" ? "video" : "image"),
        label: "参考素材",
      });
      if (message) {
        toast.error(message);
        return;
      }
    }

    submitLockRef.current = true;
    optimizeSeqRef.current += 1;
    setSubmitting(true);
    try {
      const world = getViewportCenter();
      const snapshot = useCanvasStore.getState();
      if (snapshot.currentProjectId !== projectId) throw new Error("画布已切换，请重新提交");
      const nodePrompt = promptForConnectedNode(trimmedPrompt, usedRefs);
      const target = createNode(mode, world.x, world.y, snapshot.nodes);
      const generationConfig = mode === "image"
        ? {
            modelId: selectedModel.modelId,
            quality: activeQuality,
            resolution: activeResolution,
            batchCount: 1,
          }
        : {
            modelId: selectedModel.modelId,
            resolution: activeResolution,
            duration: activeDuration,
            audio: modelConfig.audio === false ? false : videoAudio,
          };
      Object.assign(target, {
        prompt: nodePrompt,
        status: "idle" as const,
        ...(activeRatio && activeRatio !== "auto" ? { aspectRatio: activeRatio } : {}),
        ...(selectedSkill ? { skillId: selectedSkill.id, skillName: selectedSkill.title } : {}),
        generationConfig,
      });

      const addedNodes: CanvasNode[] = [target];
      const fileNodeIds = new Map<string, string>();
      let uploadIndex = 0;
      for (const ref of usedRefs) {
        if (!ref.file || fileNodeIds.has(ref.file.id)) continue;
        const file = ref.file;
        const sourceType = file.fileType === FileType.VIDEO ? "video" : "image";
        const sourceWorldX = world.x - 700;
        const sourceWorldY = world.y + uploadIndex * 390 - ((attachments.length - 1) * 195);
        const source = createNode(sourceType, sourceWorldX, sourceWorldY, [...snapshot.nodes, ...addedNodes]);
        source.title = file.originalName || source.title;
        source.status = "success";
        source.fileSize = file.fileSize;
        source.fileType = file.fileType;
        source.mimeType = file.mimeType;
        if (sourceType === "video") source.videoSrc = file.fileUrl;
        else source.imageSrc = file.fileUrl;
        addedNodes.push(source);
        fileNodeIds.set(file.id, source.id);
        uploadIndex += 1;
      }

      const connections: Connection[] = [];
      for (const ref of usedRefs) {
        const sourceId = ref.sourceNodeId ?? (ref.file ? fileNodeIds.get(ref.file.id) : undefined);
        if (!sourceId || connections.some((connection) => connection.sourceId === sourceId)) continue;
        connections.push({
          id: `conn_qs_${sourceId}_${target.id}`,
          sourceId,
          targetId: target.id,
        });
      }
      snapshot.addNodesAndConnections(addedNodes, connections, target.id);

      if (!canvasMode) {
        toast.success("已添加待生成节点，可在节点中继续调整");
      } else {
        const textRefs = usedRefs
          .filter((ref) => ref.kind === "text" && !ref.isConcept && ref.textContent?.trim())
          .map((ref) => ({ label: compactRefLabel(ref, usedRefs), content: ref.textContent || "" }));
        const conceptContext = existingSources
          .filter((node) => isConceptCanvasNodeType(node.type) && node.prompt?.trim())
          .map((node) => `${node.type === CHARACTER_NODE_TYPE ? "角色设定" : "场景设定"}（${node.title}）：${node.prompt?.trim()}`);
        const finalPrompt = [...conceptContext, inlineTextRefs(nodePrompt, textRefs).trim()]
          .filter(Boolean)
          .join("\n");
        const imageURLs = usedRefs.filter((ref) => ref.kind === "image" && ref.src).map((ref) => ref.src as string);
        const videoURLs = usedRefs.filter((ref) => ref.kind === "video" && ref.src).map((ref) => ref.src as string);
        const commonInput: Record<string, unknown> = {
          prompt: finalPrompt,
          ...(selectedSkill ? { skillId: selectedSkill.id } : {}),
          ...(ratioOptions.length ? { aspectRatio: activeRatio, aspect_ratio: activeRatio, ratio: activeRatio } : {}),
          ...(resolutionOptions.length ? { resolution: activeResolution } : {}),
        };
        const input = mode === "image"
          ? {
              ...commonInput,
              ...(qualityOptions.length ? { quality: activeQuality, clarity: activeResolution } : {}),
              ...(imageURLs.length
                ? { imageList: imageURLs, sourceImage: imageURLs[0], references: imageURLs.slice(1) }
                : {}),
            }
          : {
              ...commonInput,
              ...(durationOptions.length ? { duration: activeDuration } : {}),
              ...(modelConfig.audio !== false ? { audio: videoAudio } : {}),
              ...(handler === "image_to_video" && imageURLs.length
                ? { sourceImage: imageURLs[0] }
                : imageURLs.length
                  ? { references: imageURLs }
                  : {}),
              ...(handler === "reference_to_video" && videoURLs.length ? { videoReferences: videoURLs } : {}),
            };
        await generate({
          nodeId: target.id,
          handler,
          modelId: selectedModel.modelId,
          input,
          ...(mode === "image" && modelConfig.gridOutput ? { gridOutput: true } : {}),
        });
      }

      setPrompt("");
      setAttachments([]);
      setSelectedSkill(null);
      setRefMenuOpen(false);
      setExpanded(false);
    } catch (error) {
      toast.error((error as Error)?.message || "快速开始失败，请重试");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const displayName = (user?.nickname || user?.username || "创作者").trim();

  if (!expanded) {
    return (
      <button type="button" className={styles.collapsed} onClick={() => setExpanded(true)}>
        <Sparkles aria-hidden className="h-4 w-4" />
        快速开始
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <section className={styles.root} aria-label="画布快速开始" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className={styles.collapseButton} onClick={() => setExpanded(false)} title="收起快速开始" aria-label="收起快速开始">
        <ChevronUp aria-hidden className="h-4 w-4" />
      </button>
      <div className={styles.hero}>
        <p className={styles.greeting}>Hi {displayName}，和小云雀一起聊聊创作想法</p>
        <div className={styles.modes} role="group" aria-label="快速开始模式">
          <button
            type="button"
            aria-pressed={mode === "image"}
            className={mode === "image" ? styles.modeActive : styles.modeButton}
            onClick={() => switchMode("image")}
            title="快速生成图片节点"
          >
            <ImageIcon aria-hidden className="h-3.5 w-3.5" /> 创作快启
          </button>
          <button
            type="button"
            aria-pressed={mode === "video"}
            className={mode === "video" ? styles.modeActive : styles.modeButton}
            onClick={() => switchMode("video")}
            title="快速生成短剧视频节点"
          >
            <Clapperboard aria-hidden className="h-3.5 w-3.5" /> 短剧快启
          </button>
        </div>
      </div>

      <div className={styles.composer}>
        <div className={styles.editorWrap}>
          <PromptRefEditor
            value={prompt}
            onChange={setPrompt}
            refs={quickRefs}
            showThumbs={false}
            onSubmit={() => { void submit(); }}
            placeholder="描述你的想法，用 @ 引用画布素材，用 Skill 注入专业经验"
            ariaLabel="快速开始创作描述"
            editorClassName={styles.editor}
            editorStyle={{ minHeight: 54, maxHeight: 104 }}
          />
        </div>

        {activeRefCount > 0 && (
          <div className={styles.activeRefs}>
            {usedRefs.map((ref) => (
              <span key={ref.id} className={styles.refChip} title={`${refLabel(ref)} · ${ref.title}`}>
                {ref.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ref.thumb} alt="" />
                  : <span className={styles.refGlyph}>{ref.kind === "video" ? "▶" : "文"}</span>}
                <span>{ref.title || refLabel(ref)}</span>
                {ref.file && (
                  <button type="button" aria-label={`移除 ${ref.title}`} onClick={() => removeAttachment(ref.file!.id)}>
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !projectId}
              title="上传参考图片或视频"
            >
              {uploading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
              <span className="sr-only">上传参考素材</span>
            </button>
            <input ref={fileInputRef} className="hidden" type="file" accept="image/*,video/*" multiple onChange={handleUpload} />

            <div className={styles.modelControl}>
              <span className={styles.leadingIcon}><Sparkles aria-hidden className="h-3.5 w-3.5" /> 模型</span>
              {modelsLoaded && compatibleModels.length === 0
                ? <span className={styles.unavailable}>暂无可用模型</span>
                : !modelsLoaded
                  ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                  : <ModelPicker models={compatibleModels} value={selectedModel?.modelId ?? ""} onChange={setSelectedModelId} />}
            </div>

            <div className={styles.skillControlWrap}>
              <button type="button" className={selectedSkill ? styles.skillActive : styles.controlButton} onClick={() => setSkillPickerOpen(true)}>
                <WandSparkles aria-hidden className="h-3.5 w-3.5" />
                <span>{selectedSkill?.title || "Skill"}</span>
                <ChevronDown aria-hidden className="h-3 w-3" />
              </button>
              {selectedSkill && (
                <button
                  type="button"
                  className={styles.clearSkill}
                  aria-label={`移除 Skill：${selectedSkill.title}`}
                  onClick={() => setSelectedSkill(null)}
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              )}
            </div>

            <QuickSelect
              label="比例"
              value={activeRatio}
              options={ratioOptions}
              onChange={mode === "image" ? setImageRatio : setVideoRatio}
            />
            {mode === "image" ? (
              <>
                <QuickSelect label="清晰度" value={activeResolution} options={resolutionOptions} onChange={setImageResolution} />
                {qualityOptions.length > 1 && (
                  <QuickSelect label="画质" value={activeQuality} options={qualityOptions} onChange={setImageQuality} />
                )}
              </>
            ) : (
              <>
                <QuickSelect
                  label="时长"
                  value={String(activeDuration)}
                  options={durationOptions.map(String)}
                  onChange={(value) => setVideoDuration(Number(value))}
                  formatOption={(value) => `${value}s`}
                />
                {modelConfig.audio !== false && (
                  <button
                    type="button"
                    className={styles.controlButton}
                    onClick={() => setVideoAudio((current) => !current)}
                    title={videoAudio ? "生成有声视频" : "生成静音视频"}
                  >
                    {videoAudio
                      ? <Volume2 aria-hidden className="h-3.5 w-3.5" />
                      : <VolumeX aria-hidden className="h-3.5 w-3.5" />}
                    {videoAudio ? "有声" : "静音"}
                  </button>
                )}
              </>
            )}

            <div ref={refMenuWrapRef} className={styles.refMenuWrap}>
              <button
                ref={refMenuTriggerRef}
                type="button"
                className={styles.controlButton}
                onClick={toggleRefMenu}
                disabled={quickRefs.length === 0}
                title={quickRefs.length ? "引用画布里的素材" : "画布里暂无可引用素材"}
                aria-haspopup="menu"
                aria-expanded={refMenuOpen}
              >
                <AtSign aria-hidden className="h-3.5 w-3.5" /> 引用
                {activeRefCount > 0 && <span className={styles.countBadge}>{activeRefCount}</span>}
              </button>
            </div>
          </div>

          <div className={styles.toolbarRight}>
            {uploading && <span className={styles.progress} aria-live="polite"><Paperclip aria-hidden className="h-3.5 w-3.5" /> {uploadProgress}%</span>}
            <button
              type="button"
              className={styles.optimizeButton}
              onClick={() => { void optimizePrompt(); }}
              disabled={!prompt.trim() || optimizing || submitting}
              title="AI 优化提示词"
              aria-label="AI 优化提示词"
            >
              {optimizing ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <WandSparkles aria-hidden className="h-4 w-4" />}
            </button>
            <div className={styles.canvasToggle} title="关闭后只添加待生成节点，方便继续精调">
              <span>{canvasMode ? "画布模式" : "仅添加节点"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={canvasMode}
                aria-label={canvasMode ? "画布模式已开启，提交后立即生成" : "画布模式已关闭，仅添加待生成节点"}
                className={canvasMode ? styles.switchOn : styles.switchOff}
                onClick={() => setCanvasMode((current) => !current)}
              >
                <span />
              </button>
            </div>
            <button
              type="button"
              className={styles.submitButton}
              onClick={() => { void submit(); }}
              disabled={submitting || uploading || optimizing || !prompt.trim() || !projectId || !selectedModel}
              title={canvasMode ? `生成${mode === "image" ? "图片" : "视频"}并添加到画布` : "添加待生成节点"}
              aria-label={canvasMode ? `生成${mode === "image" ? "图片" : "视频"}并添加到画布` : "添加待生成节点"}
            >
              {submitting ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {refMenuOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={refMenuPanelRef}
          className={`${styles.refMenu} ${refMenuPosition.openUp ? styles.refMenuOpenUp : ""}`}
          role="menu"
          aria-label="引用画布素材"
          style={{ left: refMenuPosition.left, top: refMenuPosition.top }}
          onKeyDown={handleRefMenuKeyDown}
        >
          {quickRefs.map((ref) => {
            const active = containsRef(prompt, ref) || !!ref.file;
            return (
              <button
                key={ref.id}
                type="button"
                role="menuitem"
                disabled={active}
                onClick={() => {
                  setPrompt((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${refLabel(ref)} `);
                  setRefMenuOpen(false);
                  refMenuTriggerRef.current?.focus();
                }}
              >
                {ref.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ref.thumb} alt="" />
                  : <span className={styles.refGlyph}>{ref.kind === "video" ? "▶" : "文"}</span>}
                <span><strong>{ref.title || refLabel(ref)}</strong><small>{refLabel(ref)}</small></span>
                {active && <span className={styles.usedMark}>已引用</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}

      <SkillPicker
        open={skillPickerOpen}
        onClose={() => setSkillPickerOpen(false)}
        onPick={pickSkill}
        currentId={selectedSkill?.id}
        kinds={["preset"]}
        entryPoint="canvas"
        targetType={mode}
        outputType={mode}
      />
    </section>
  );
}
