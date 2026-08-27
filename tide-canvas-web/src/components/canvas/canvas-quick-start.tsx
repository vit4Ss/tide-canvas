"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
  Paperclip,
  PencilLine,
  Plus,
  Ratio,
  ScanLine,
  Wand2,
  X,
} from "lucide-react";
import { SkillPicker } from "@/components/skill/skill-picker";
import { SkillPromptChip } from "@/components/skill/skill-prompt-chip";
import { toast } from "@/components/shared/toast";
import { resumeGeneration, useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { createNode } from "@/lib/canvas-helpers";
import { aiApi, uploadFileSmart } from "@/lib/api";
import {
  clearCanvasLaunchJournal,
  readCanvasLaunchJournal,
  updateCanvasLaunchJournal,
  type CanvasLaunchGenerationPayload,
  type CanvasLaunchJournal,
  type CanvasLaunchPlan,
} from "@/lib/canvas-launch";
import { requestCanvasSave } from "@/lib/canvas-save";
import { supportsOmniReference, type OmniReferenceKind } from "@/lib/omni-reference";
import {
  canvasLaunchCanSubmit,
  canvasLaunchKindFor,
  canvasLauncherAllowsDirectModel,
  canvasLaunchNeedsDirectModel,
} from "@/lib/canvas-launch-policy";
import {
  CHARACTER_NODE_TYPE,
  isConceptCanvasNodeType,
  isImageReferenceNodeType,
} from "@/lib/canvas-node-types";
import { parseSkillParams } from "@/lib/skill-api";
import { promptAfterSkillPick } from "@/lib/skill-prompt";
import {
  referenceKindFromFile,
  resolveModelReferenceCountLimit,
  resolveModelReferenceLimitBytes,
  validateKnownFileSize,
} from "@/lib/upload-limits";
import { useCanvasStore, type CanvasNode, type Connection } from "@/stores/use-canvas-store";
import { AiModelType, type AiModelVO } from "@/types/ai";
import type { ModelConfig } from "@/types/admin-models";
import { FileType, type FileVO } from "@/types/file";
import { skillKindOf, skillOutputTypesOf, type SkillVO } from "@/types/skill";
import { ModelPicker } from "./nodes/model-picker";
import { PromptRefEditor } from "./nodes/prompt-ref-editor";
import { inlineTextRefs, refGlyph, refLabel, type RefItem, type RefKind } from "./nodes/prompt-ref-utils";
import { RATIO_OPTIONS } from "./nodes/quality-ratio-picker";
import { parseModelConfig, validateReferenceFileSizes } from "./nodes/shared/node-utils";
import { normalizeDurations, VIDEO_RATIOS } from "./nodes/video-param-picker";
import { CANVAS_ASSISTANT_VISIBILITY_EVENT } from "./canvas-assistant-panel";
import styles from "./styles/canvas-quick-start.module.css";

type QuickStartMode = "image" | "video";
type QuickStartVariant = "canvas" | "launcher" | "consumer";

interface Props {
  getViewportCenter?: () => { x: number; y: number };
  variant?: QuickStartVariant;
  onLaunch?: (draft: CanvasLaunchPlan) => Promise<boolean>;
  /** 项目页示例按钮发起的一次性填充请求；id 用于允许重复选择同一示例。 */
  promptFillRequest?: { id: number; text: string } | null;
  /** 仅在示例文本确实写入内部 prompt 后确认，供外层提供准确的无障碍反馈。 */
  onPromptFillApplied?: (id: number) => void;
  /** 上次跨页创建尚未处理时，锁住新提交以避免产生第二个幂等请求号。 */
  launchBlocked?: boolean;
  launchBlockedReason?: string;
  initialPlan?: CanvasLaunchPlan | null;
  launchJournal?: CanvasLaunchJournal | null;
  onLaunchConsumed?: () => void;
  persistenceReady?: boolean;
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
  batchSizes?: number[];
  gridOutput?: boolean;
}

const DEFAULT_IMAGE_RATIOS = RATIO_OPTIONS.map((option) => option.value);
const DEFAULT_VIDEO_RATIOS = VIDEO_RATIOS.map((option) => option.value);
const MAX_QUICK_ATTACHMENTS = 8;

const HANDLER_CONFIG_MODES: Record<string, string> = {
  text_to_image: "t2i",
  image_to_image: "i2i",
  text_to_video: "t2v",
  image_to_video: "i2v",
  start_end_to_video: "keyframe",
  reference_to_video: "omni_ref",
};

function supportsHandler(model: AiModelVO, handler: string) {
  if (model.supportedHandlers?.length) return model.supportedHandlers.includes(handler);
  const configuredModes = stringArray(parseModelConfig<Record<string, unknown>>(model).modes);
  if (!configuredModes?.length) return true;
  const mode = HANDLER_CONFIG_MODES[handler];
  return mode ? configuredModes.includes(mode) : true;
}

type QuickReferenceCounts = Record<OmniReferenceKind, number>;

function supportsQuickHandlerInput(
  model: AiModelVO,
  handler: string,
  counts: QuickReferenceCounts,
): boolean {
  if (!supportsHandler(model, handler)) return false;
  if (handler !== "reference_to_video") return true;
  const config = parseModelConfig<ModelConfig>(model);
  return (Object.keys(counts) as OmniReferenceKind[]).every(
    (kind) => counts[kind] === 0 || supportsOmniReference(config, kind),
  );
}

function quickModeFromModel(model?: AiModelVO): QuickStartMode | null {
  if (model?.type === AiModelType.IMAGE) return "image";
  if (model?.type === AiModelType.VIDEO) return "video";
  return null;
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
    ...(typeof raw.gridOutput === "boolean" ? { gridOutput: raw.gridOutput } : {}),
  };
}

function referenceCountLimit(model: AiModelVO, handler: string, kind: "image" | "video" | "audio") {
  return resolveModelReferenceCountLimit(model, kind, handler);
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
    if (node.type === "audio" && node.audioSrc) {
      pushQuickRef(refs, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: "",
        src: node.audioSrc,
        title: node.title || "画布音频",
        kind: "audio",
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
    } else if (file.mimeType?.startsWith("audio/")) {
      pushQuickRef(refs, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: "",
        src: file.fileUrl,
        title: file.originalName,
        kind: "audio",
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

function defaultOptionLabel(value: string) {
  const labels: Record<string, string> = {
    auto: "自动",
    low: "低",
    medium: "中",
    high: "高",
    standard: "标准",
    ultra: "超高",
  };
  return labels[value.toLowerCase()] ?? value;
}

function QuickSelect({ label, value, options, onChange, disabled, formatOption, icon, dark = false }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  formatOption?: (value: string) => string;
  icon?: ReactNode;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelPos, setPanelPos] = useState({ left: 12, top: 12, width: 160, maxHeight: 240 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const optionLabel = (option: string) => formatOption?.(option) ?? defaultOptionLabel(option);
  const currentLabel = optionLabel(value);
  const unavailable = disabled || options.length === 0;

  const focusNextToolbarControl = (backward: boolean) => {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) =>
      !panelRef.current?.contains(element) &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
    );
    const triggerIndex = triggerRef.current ? focusable.indexOf(triggerRef.current) : -1;
    if (triggerIndex < 0) return;
    const nextIndex = backward ? triggerIndex - 1 : triggerIndex + 1;
    focusable[(nextIndex + focusable.length) % focusable.length]?.focus();
  };

  const positionPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 12;
    const gap = 8;
    const panelWidth = Math.min(184, Math.max(152, Math.ceil(rect.width) + 32));
    const estimatedHeight = Math.min(240, options.length * 38 + 12);
    const spaceBelow = window.innerHeight - rect.bottom - gap - gutter;
    const spaceAbove = rect.top - gap - gutter;
    const nextOpenUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableHeight = nextOpenUp ? spaceAbove : spaceBelow;
    setOpenUp(nextOpenUp);
    setPanelPos({
      left: Math.min(Math.max(gutter, Math.round(rect.left)), Math.max(gutter, window.innerWidth - panelWidth - gutter)),
      top: Math.round(nextOpenUp ? rect.top - gap : rect.bottom + gap),
      width: panelWidth,
      maxHeight: Math.max(64, Math.min(240, availableHeight)),
    });
  };

  const openMenu = (preferredIndex?: number) => {
    if (unavailable) return;
    const selectedIndex = Math.max(0, options.indexOf(value));
    setActiveIndex(preferredIndex ?? selectedIndex);
    positionPanel();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
        ?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (triggerRef.current?.contains(target) || panelRef.current?.contains(target))
      ) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const closeOnViewportResize = () => setOpen(false);
    const closeOnViewportScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeOnViewportResize);
    window.addEventListener("scroll", closeOnViewportScroll, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeOnViewportResize);
      window.removeEventListener("scroll", closeOnViewportScroll, true);
    };
  }, [open]);

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => focusNextToolbarControl(event.shiftKey));
      return;
    }
    const items = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      : [];
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    items[nextIndex]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.selectControl}
        title={`${label}：${currentLabel}`}
        aria-label={`${label}，当前 ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={unavailable}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) return;
          const selectedIndex = Math.max(0, options.indexOf(value));
          openMenu(event.key === "ArrowUp" ? Math.max(0, selectedIndex) : selectedIndex);
        }}
      >
      {icon && <span className={styles.controlIcon} aria-hidden>{icon}</span>}
      <span className={styles.controlLabel}>{label}</span>
        <span className={styles.selectValue}>{options.length ? currentLabel : "模型默认"}</span>
        <ChevronDown aria-hidden className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          id={panelId}
          ref={panelRef}
          role="listbox"
          aria-label={label}
          className={`${styles.selectMenu} ${dark ? styles.selectMenuDark : ""} ${openUp ? styles.selectMenuOpenUp : ""}`}
          style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width, maxHeight: panelPos.maxHeight }}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={handlePanelKeyDown}
        >
          {options.map((option, index) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={index === activeIndex ? 0 : -1}
                className={`${styles.selectOption} ${selected ? styles.selectOptionActive : ""}`}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                <span>{optionLabel(option)}</span>
                {selected && <Check aria-hidden className={styles.selectCheck} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export function CanvasQuickStart({
  getViewportCenter,
  variant = "canvas",
  onLaunch,
  promptFillRequest,
  onPromptFillApplied,
  launchBlocked = false,
  launchBlockedReason = "请先处理上次未完成的创作",
  initialPlan,
  launchJournal,
  onLaunchConsumed,
  persistenceReady = false,
}: Props) {
  const isLauncher = variant === "launcher";
  const referenceSignature = useCanvasStore((state) => JSON.stringify(state.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    prompt: node.prompt,
    content: node.content,
    imageSrc: node.imageSrc,
    videoSrc: node.videoSrc,
    audioSrc: node.audioSrc,
    fileSize: node.fileSize,
    fileType: node.fileType,
    mimeType: node.mimeType,
  }))));
  const projectId = useCanvasStore((state) => state.currentProjectId);
  const referenceNodes = useMemo(() => {
    void referenceSignature;
    return variant === "canvas" ? useCanvasStore.getState().nodes : [];
  }, [referenceSignature, variant]);
  const { generate } = useAiGeneration();
  const [expanded, setExpanded] = useState(true);
  // 助手打开时其占位宽度（含右缘偏移与间隔）由可见性事件广播，根容器按它右缩避让。
  const [assistantInset, setAssistantInset] = useState(0);
  const [mode, setMode] = useState<QuickStartMode>(isLauncher ? "video" : "image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoadError, setModelsLoadError] = useState(false);
  const [modelsRetryNonce, setModelsRetryNonce] = useState(0);
  // 拿到过一次列表（含空列表）后，后台静默重取失败不再清空列表、不亮失败态。
  const hasModelsDataRef = useRef(false);
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
  const [launchSubmitNonce, setLaunchSubmitNonce] = useState(0);
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
  const launchAppliedProjectRef = useRef<string | null>(null);
  const appliedPromptFillIdRef = useRef<number | null>(null);
  const initialPlanAppliedRef = useRef(false);
  const launchAttemptRef = useRef(0);
  const launchRetryCountRef = useRef(0);
  const launchRetryTimerRef = useRef<number | null>(null);
  const previousRefsRef = useRef<{ projectId: string | null; refs: QuickRef[] }>({ projectId: null, refs: [] });
  const [refMenuPosition, setRefMenuPosition] = useState({ left: 12, top: 12, openUp: false, maxHeight: 288 });

  useEffect(() => {
    promptValueRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    if (
      variant !== "launcher" ||
      !promptFillRequest ||
      appliedPromptFillIdRef.current === promptFillRequest.id
    ) return;
    const frame = requestAnimationFrame(() => {
      appliedPromptFillIdRef.current = promptFillRequest.id;
      if (launchBlocked || submitLockRef.current || initialPlan) return;
      const nextPrompt = promptFillRequest.text.replace(/\r\n?/g, "\n").trim();
      if (!nextPrompt) return;
      optimizeSeqRef.current += 1;
      setOptimizing(false);
      setSkillPickerOpen(false);
      setRefMenuOpen(false);
      promptValueRef.current = nextPrompt;
      setPrompt(nextPrompt);
      onPromptFillApplied?.(promptFillRequest.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPlan, launchBlocked, onPromptFillApplied, promptFillRequest, variant]);

  useEffect(() => () => {
    if (launchRetryTimerRef.current != null) window.clearTimeout(launchRetryTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    void aiApi.listModels()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          hasModelsDataRef.current = true;
          setModels(result.data ?? []);
          setModelsLoadError(false);
        } else if (!hasModelsDataRef.current) {
          setModels([]);
          setModelsLoadError(true);
        }
      })
      .catch(() => {
        if (!active) return;
        if (!hasModelsDataRef.current) {
          setModels([]);
          setModelsLoadError(true);
        }
      })
      .finally(() => {
        if (active) setModelsLoaded(true);
      });
    return () => { active = false; };
  }, [modelsRetryNonce]);

  const retryModels = () => {
    setModelsLoaded(false);
    setModelsLoadError(false);
    setModelsRetryNonce((current) => current + 1);
  };

  // 参照创作台 use-studio-models：窗口重回焦点/可见时静默重取，偶发失败
  // 自动恢复，后台模型改动也免刷新生效；重取不清空已有列表（见上方守卫）。
  useEffect(() => {
    const reloadModels = () => setModelsRetryNonce((current) => current + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadModels();
    };
    window.addEventListener("focus", reloadModels);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reloadModels);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (variant !== "canvas") return;
    const handleAssistantVisibility = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ open?: boolean; width?: number }>;
      const open = !!event.detail?.open;
      setAssistantInset(open ? Math.max(0, event.detail?.width ?? 0) : 0);
      if (!open) return;
      setExpanded(false);
      setRefMenuOpen(false);
      setSkillPickerOpen(false);
    };
    window.addEventListener(CANVAS_ASSISTANT_VISIBILITY_EVENT, handleAssistantVisibility);
    return () => window.removeEventListener(CANVAS_ASSISTANT_VISIBILITY_EVENT, handleAssistantVisibility);
  }, [variant]);

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
      requestAnimationFrame(() => refMenuTriggerRef.current?.focus());
    };
    const closeOnViewportResize = () => setRefMenuOpen(false);
    const closeOnViewportScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && refMenuPanelRef.current?.contains(target)) return;
      setRefMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeOnViewportResize);
    window.addEventListener("scroll", closeOnViewportScroll, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", closeOnViewportResize);
      window.removeEventListener("scroll", closeOnViewportScroll, true);
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
      setExpanded(true);
    });
    return () => cancelAnimationFrame(frame);
    // quickRefs is deliberately excluded: this reset is scoped to a project epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (
      variant !== "consumer" ||
      !projectId ||
      !launchJournal ||
      launchJournal.projectId !== projectId ||
      launchAppliedProjectRef.current === projectId
    ) return;
    const frame = requestAnimationFrame(() => {
      if (useCanvasStore.getState().currentProjectId !== projectId) return;
      launchAppliedProjectRef.current = projectId;
      launchRetryCountRef.current = 0;
      setMode(launchJournal.mode);
      setPrompt(launchJournal.prompt);
      setAttachments(launchJournal.attachments);
      setSelectedSkill(launchJournal.selectedSkill);
      setSelectedModelId(launchJournal.modelId);
      setCanvasMode(launchJournal.canvasMode);
      setImageRatio(launchJournal.imageRatio);
      setImageQuality(launchJournal.imageQuality);
      setImageResolution(launchJournal.imageResolution);
      setVideoRatio(launchJournal.videoRatio);
      setVideoResolution(launchJournal.videoResolution);
      setVideoDuration(launchJournal.videoDuration);
      setExpanded(true);
      if (launchJournal.state === "failed") {
        toast.error(launchJournal.error || "自动创作未完成，请在画布节点中重试");
      } else if (!launchJournal.selectedSkill) {
        setLaunchSubmitNonce((current) => current + 1);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [launchJournal, projectId, variant]);

  useEffect(() => {
    if (variant !== "launcher" || !initialPlan || initialPlanAppliedRef.current) return;
    initialPlanAppliedRef.current = true;
    const frame = requestAnimationFrame(() => {
      const initialMode = initialPlan.selectedSkill ? initialPlan.mode : "video";
      setMode(initialMode);
      setPrompt(initialPlan.prompt);
      setAttachments(initialPlan.attachments);
      setSelectedSkill(initialPlan.selectedSkill);
      setSelectedModelId(initialMode === initialPlan.mode ? initialPlan.modelId : "");
      setCanvasMode(initialPlan.canvasMode);
      setImageRatio(initialPlan.imageRatio);
      setImageQuality(initialPlan.imageQuality);
      setImageResolution(initialPlan.imageResolution);
      setVideoRatio(initialPlan.videoRatio);
      setVideoResolution(initialPlan.videoResolution);
      setVideoDuration(initialPlan.videoDuration);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPlan, variant]);

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
  const imageRefCount = usedRefs.filter((ref) => ref.kind === "image").length;
  const videoRefCount = usedRefs.filter((ref) => ref.kind === "video").length;
  const audioRefCount = usedRefs.filter((ref) => ref.kind === "audio").length;
  const referenceCounts: QuickReferenceCounts = {
    image: imageRefCount,
    video: videoRefCount,
    audio: audioRefCount,
  };
  const hasSkillSelection = !!selectedSkill;
  const isAgentSelection = !!selectedSkill && skillKindOf(selectedSkill) === "agent";
  const preferredHandlerFor = (targetMode: QuickStartMode) => targetMode === "image"
    ? imageRefCount > 0 ? "image_to_image" : "text_to_image"
    : videoRefCount > 0 || audioRefCount > 0 || imageRefCount > 1
      ? "reference_to_video"
      : imageRefCount === 1
        ? "image_to_video"
        : "text_to_video";
  const modelType = mode === "image" ? AiModelType.IMAGE : AiModelType.VIDEO;
  const typeModels = models.filter((model) => model.type === modelType);
  const preferredHandler = preferredHandlerFor(mode);
  const requestedModel = typeModels.find((model) => model.modelId === selectedModelId)
    ?? typeModels.find((model) => model.modelId === selectedSkill?.modelId);
  const handler = preferredHandler === "image_to_video"
    && (
      requestedModel
        ? !supportsHandler(requestedModel, preferredHandler)
          && supportsQuickHandlerInput(requestedModel, "reference_to_video", referenceCounts)
        : !typeModels.some((model) => supportsHandler(model, preferredHandler))
          && typeModels.some((model) => supportsQuickHandlerInput(model, "reference_to_video", referenceCounts))
    )
    ? "reference_to_video"
    : preferredHandler;
  const compatibleModels = typeModels.filter((model) => supportsQuickHandlerInput(model, handler, referenceCounts));
  const selectableModels = models.filter((model) => {
    const candidateMode = quickModeFromModel(model);
    if (!candidateMode) return false;
    if (isLauncher && !canvasLauncherAllowsDirectModel(model)) return false;
    if (candidateMode === "image" && (videoRefCount > 0 || audioRefCount > 0)) return false;
    const candidateHandler = preferredHandlerFor(candidateMode);
    return supportsQuickHandlerInput(model, candidateHandler, referenceCounts)
      || (candidateHandler === "image_to_video"
        && supportsQuickHandlerInput(model, "reference_to_video", referenceCounts));
  });
  const selectedModel = compatibleModels.find((model) => model.modelId === selectedModelId)
    ?? compatibleModels.find((model) => model.modelId === selectedSkill?.modelId)
    ?? compatibleModels[0];
  const directModelId = isLauncher && !canvasLauncherAllowsDirectModel(selectedModel)
    ? ""
    : selectedModel?.modelId ?? "";
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
  const submitActionLabel = isLauncher && selectedSkill
    ? `创建新画布并运行「${selectedSkill.title}」`
    : isLauncher
    ? canvasMode
      ? `创建新画布并生成${mode === "image" ? "图片" : "视频"}`
      : "创建新画布并添加待生成节点"
    : canvasMode
      ? `生成${mode === "image" ? "图片" : "视频"}并添加到画布`
      : "添加待生成节点";

  const cancelOptimization = () => {
    optimizeSeqRef.current += 1;
    setOptimizing(false);
  };

  const clearSelectedSkill = () => {
    setSelectedSkill(null);
    if (!isLauncher) return;
    setMode("video");
    setSelectedModelId("");
    setRefMenuOpen(false);
    cancelOptimization();
  };

  const selectModel = (modelId: string) => {
    if (uploading) {
      toast.info("参考素材上传完成后再切换模型");
      return;
    }
    // 预设技能可能固定另一张模型卡，服务端执行时会以技能模型为准。
    // 用户主动选了不同模型就移除预设，确保下拉展示/积分预估与实际执行一致。
    if (
      modelId !== selectedModel?.modelId
      && selectedSkill
      && skillKindOf(selectedSkill) === "preset"
    ) {
      setSelectedSkill(null);
    }
    const nextModel = models.find((model) => model.modelId === modelId);
    if (isLauncher && !canvasLauncherAllowsDirectModel(nextModel)) {
      toast.info("画布入口仅支持视频模型");
      return;
    }
    const nextMode = quickModeFromModel(nextModel);
    if (nextMode && nextMode !== mode) {
      setMode(nextMode);
      setSelectedSkill(null);
      setRefMenuOpen(false);
      cancelOptimization();
    }
    setSelectedModelId(modelId);
  };

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
    const availableHeight = openUp ? rect.top - 20 : window.innerHeight - rect.bottom - 20;
    setRefMenuPosition({
      left: Math.min(Math.max(10, rect.left), Math.max(10, window.innerWidth - panelWidth - 10)),
      top: openUp ? rect.top - 8 : rect.bottom + 8,
      openUp,
      maxHeight: Math.max(64, Math.min(panelHeight, availableHeight)),
    });
    setRefMenuOpen(true);
  };

  const handleRefMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      setRefMenuOpen(false);
      requestAnimationFrame(() => {
        const focusable = Array.from(document.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((element) =>
          !refMenuPanelRef.current?.contains(element) &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
        );
        const triggerIndex = refMenuTriggerRef.current ? focusable.indexOf(refMenuTriggerRef.current) : -1;
        if (triggerIndex < 0) return;
        const nextIndex = event.shiftKey ? triggerIndex - 1 : triggerIndex + 1;
        focusable[(nextIndex + focusable.length) % focusable.length]?.focus();
      });
      return;
    }
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

  const updatePrompt = (nextPrompt: string) => {
    if (isLauncher && !skillPickerOpen && /(^|[\s\u200b])\/$/.test(nextPrompt)) {
      setPrompt(nextPrompt.slice(0, -1));
      setSkillPickerOpen(true);
      return;
    }
    if (mode === "image" && quickRefs.some((ref) =>
      (ref.kind === "video" || ref.kind === "audio") && containsRef(nextPrompt, ref),
    )) {
      setMode("video");
      if (!hasSkillSelection) {
        setSelectedModelId("");
        setSelectedSkill(null);
      }
      cancelOptimization();
    }
    setPrompt(nextPrompt);
  };

  const pickSkill = (skill: SkillVO) => {
    const kind = skillKindOf(skill);
    // 项目页只负责把 Agent 输入交接到新画布；已在画布中的快速生成栏
    // 仍只接受单输出预设，避免误发到普通 ai.generate。
    if (kind === "agent" && variant !== "launcher") {
      toast.info("智能技能请进入画布后使用");
      return;
    }
    if (kind !== "preset" && kind !== "agent") return;
    const launcherPresetMode = kind === "preset" && variant === "launcher"
      ? skillOutputTypesOf(skill).find((output): output is QuickStartMode => output === "image" || output === "video")
      : undefined;
    if (kind === "preset" && variant === "launcher" && !launcherPresetMode) {
      toast.info("顶部创作栏仅支持图片或视频预设");
      return;
    }
    setPrompt((current) => {
      const next = promptAfterSkillPick(current, skill, selectedSkill);
      promptValueRef.current = next;
      return next;
    });
    setSelectedSkill(skill);
    setSkillPickerOpen(false);
    // A selected Skill always runs through the new canvas assistant. Deferred
    // idle nodes use the ordinary model path and therefore cannot retain Skill semantics.
    if (variant === "launcher") setCanvasMode(true);
    if (kind === "agent") {
      return;
    }
    const presetMode = variant === "launcher"
      ? launcherPresetMode ?? mode
      : mode;
    if (presetMode !== mode) {
      setMode(presetMode);
      setSelectedModelId("");
      cancelOptimization();
    }
    if (skill.modelId) setSelectedModelId(skill.modelId);
    const defaults = parseSkillParams(skill.defaultParams);
    if (defaults.aspectRatio) {
      if (presetMode === "image") setImageRatio(defaults.aspectRatio);
      else setVideoRatio(defaults.aspectRatio);
    }
    if (defaults.resolution) {
      if (presetMode === "image") setImageResolution(defaults.resolution);
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
    if (!isLauncher && !projectId) {
      toast.info("画布仍在加载，请稍后再添加参考素材");
      return;
    }
    const uploadSeq = ++uploadSeqRef.current;
    const projectEpoch = projectEpochRef.current;
    const launchProjectId = projectId;
    const isCurrent = () =>
      uploadSeq === uploadSeqRef.current &&
      projectEpoch === projectEpochRef.current &&
      (isLauncher || useCanvasStore.getState().currentProjectId === launchProjectId);
    const remaining = Math.max(0, MAX_QUICK_ATTACHMENTS - attachments.length);
    if (remaining === 0) {
      toast.info(`快速开始最多添加 ${MAX_QUICK_ATTACHMENTS} 个参考素材`);
      return;
    }
    const supportedFiles = files.filter((file) =>
      file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/"),
    );
    const accepted = supportedFiles.slice(0, remaining);
    if (supportedFiles.length !== files.length) toast.info("画布创作栏当前支持图片、视频和音频参考");
    if (supportedFiles.length > remaining) toast.info(`本次仅添加前 ${remaining} 个素材，创作栏最多保留 ${MAX_QUICK_ATTACHMENTS} 个`);
    if (!accepted.length) return;

    const includesVideoOrAudio = accepted.some((file) => file.type.startsWith("video/") || file.type.startsWith("audio/"));
    const uploadMode: QuickStartMode = includesVideoOrAudio ? "video" : mode;
    const prospectiveImageCount = imageRefCount + accepted.filter((file) => file.type.startsWith("image/")).length;
    const prospectiveVideoCount = videoRefCount + accepted.filter((file) => file.type.startsWith("video/")).length;
    const prospectiveAudioCount = audioRefCount + accepted.filter((file) => file.type.startsWith("audio/")).length;
    const prospectiveCounts: QuickReferenceCounts = {
      image: prospectiveImageCount,
      video: prospectiveVideoCount,
      audio: prospectiveAudioCount,
    };
    const preferredUploadHandler = uploadMode === "image"
      ? "image_to_image"
      : prospectiveVideoCount > 0 || prospectiveAudioCount > 0 || prospectiveImageCount > 1
        ? "reference_to_video"
        : prospectiveImageCount === 1
          ? "image_to_video"
          : "text_to_video";
    const skillHandoff = hasSkillSelection;
    const uploadType = uploadMode === "image" ? AiModelType.IMAGE : AiModelType.VIDEO;
    const uploadModels = models.filter((model) => model.type === uploadType);
    const currentUploadModel = skillHandoff
      ? undefined
      : uploadModels.find((model) => model.modelId === selectedModel?.modelId);
    let uploadHandler = preferredUploadHandler;
    let uploadModel = currentUploadModel && supportsQuickHandlerInput(currentUploadModel, uploadHandler, prospectiveCounts)
      ? currentUploadModel
      : undefined;
    if (!skillHandoff && preferredUploadHandler === "image_to_video") {
      if (!uploadModel && currentUploadModel
        && supportsQuickHandlerInput(currentUploadModel, "reference_to_video", prospectiveCounts)) {
        uploadHandler = "reference_to_video";
        uploadModel = currentUploadModel;
      } else if (!uploadModel) {
        uploadModel = uploadModels.find((model) => supportsHandler(model, "image_to_video"))
          ?? uploadModels.find((model) => supportsQuickHandlerInput(model, "reference_to_video", prospectiveCounts));
        if (uploadModel && !supportsHandler(uploadModel, "image_to_video")) uploadHandler = "reference_to_video";
      }
    } else if (!skillHandoff && !uploadModel) {
      uploadModel = uploadModels.find((model) => supportsQuickHandlerInput(model, uploadHandler, prospectiveCounts));
    }
    if (!skillHandoff && modelsLoaded && !uploadModel) {
      toast.info("没有支持这些参考素材的可用模型");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    const uploaded: FileVO[] = [];
    for (const file of accepted) {
      try {
        const kind = referenceKindFromFile(file);
        const referenceLabel = file.type.startsWith("video/")
          ? "参考视频"
          : file.type.startsWith("audio/")
            ? "参考音频"
            : "参考图片";
        const result = await uploadFileSmart(file, (progress) => {
          if (isCurrent()) setUploadProgress(progress);
        }, {
          maxBytes: resolveModelReferenceLimitBytes(uploadModel, kind, uploadHandler),
          label: referenceLabel,
        });
        if (!isCurrent()) return;
        if (result.success && result.data) uploaded.push(result.data);
        else toast.error(result.message || `上传失败：${file.name}`);
      } catch (error) {
        if (isCurrent()) toast.error((error as Error)?.message || `上传失败：${file.name}`);
      }
    }
    if (isCurrent() && uploaded.length) {
      if (!skillHandoff && uploadMode !== mode) {
        setMode(uploadMode);
        cancelOptimization();
      }
      if (!skillHandoff && uploadModel && uploadModel.modelId !== selectedModelId) setSelectedModelId(uploadModel.modelId);
      if (!skillHandoff && uploadMode !== mode) {
        setSelectedSkill(null);
      }
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
        (isLauncher || useCanvasStore.getState().currentProjectId === launchProjectId);
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

  const scheduleConsumerRetry = useCallback((message: string) => {
    if (variant !== "consumer" || !launchJournal) return;
    if (launchRetryCountRef.current >= 3) {
      toast.info(`${message}。网络恢复后刷新画布可继续确认`);
      return;
    }
    launchRetryCountRef.current += 1;
    if (launchRetryTimerRef.current != null) window.clearTimeout(launchRetryTimerRef.current);
    launchRetryTimerRef.current = window.setTimeout(() => {
      launchRetryTimerRef.current = null;
      setLaunchSubmitNonce((current) => current + 1);
    }, 1600 * launchRetryCountRef.current);
  }, [launchJournal, variant]);

  const submit = async () => {
    if (submitLockRef.current || submitting) return;
    if (isLauncher && launchBlocked) {
      toast.info(launchBlockedReason);
      return;
    }
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
    if (!isLauncher && !projectId) {
      toast.info("画布仍在加载，请稍后再试");
      return;
    }
    const launchKind = isLauncher ? canvasLaunchKindFor(selectedSkill) : null;
    if (isLauncher && (!launchKind || !canvasLaunchCanSubmit(selectedSkill, directModelId))) {
      toast.error(selectedSkill ? "当前技能不支持从画布入口启动" : "请选择可用的视频模型");
      return;
    }
    const state = useCanvasStore.getState();
    const existingSources = usedRefs
      .flatMap((ref) => ref.sourceNodeId ? state.nodes.filter((node) => node.id === ref.sourceNodeId) : []);
    if (canvasLaunchNeedsDirectModel(selectedSkill)) {
      if (!selectedModel) {
        toast.error(modelsLoaded ? "没有支持当前生成方式的模型" : "模型正在加载");
        return;
      }
      if (isLauncher && !canvasLauncherAllowsDirectModel(selectedModel)) {
        toast.error("画布入口请选择视频模型");
        return;
      }
      if (mode === "image" && usedRefs.some((ref) => ref.kind === "video" || ref.kind === "audio")) {
        toast.info("图片模型仅支持图片参考，请切换视频模型或移除视频/音频引用");
        return;
      }
      if (handler === "reference_to_video") {
        const omniConfig = parseModelConfig<ModelConfig>(selectedModel);
        const unsupported = ([
          ["image", imageRefCount, "参考图片"],
          ["video", videoRefCount, "参考视频"],
          ["audio", audioRefCount, "参考音频"],
        ] as const).find(([kind, count]) => count > 0 && !supportsOmniReference(omniConfig, kind));
        if (unsupported) {
          toast.info(`${selectedModel.name} 不支持${unsupported[2]}，请移除或更换模型`);
          return;
        }
      }
      for (const [kind, count, label] of [
        ["image", imageRefCount, "参考图片"],
        ["video", videoRefCount, "参考视频"],
        ["audio", audioRefCount, "参考音频"],
      ] as const) {
        const limit = referenceCountLimit(selectedModel, handler, kind);
        if (limit && count > limit) {
          toast.info(`${selectedModel.name} 最多支持 ${limit} 个${label}，当前为 ${count} 个`);
          return;
        }
      }

      if (!validateReferenceFileSizes(existingSources, selectedModel, handler)) return;
      for (const ref of usedRefs) {
        if (!ref.file) continue;
        const message = validateKnownFileSize(ref.file.fileSize, ref.file.originalName, {
          maxBytes: resolveModelReferenceLimitBytes(
            selectedModel,
            ref.kind === "video" ? "video" : ref.kind === "image" ? "image" : ref.kind === "audio" ? "audio" : "file",
            handler,
          ),
          label: "参考素材",
        });
        if (message) {
          toast.error(message);
          return;
        }
      }
    }

    if (isLauncher) {
      if (!onLaunch) {
        toast.error("新建画布入口暂不可用");
        return;
      }
      submitLockRef.current = true;
      optimizeSeqRef.current += 1;
      setSubmitting(true);
      try {
        const launched = await onLaunch({
          launchKind: launchKind!,
          prompt: trimmedPrompt,
          mode,
          modelId: hasSkillSelection ? "" : directModelId,
          selectedSkill,
          attachments,
          canvasMode,
          imageRatio,
          imageQuality,
          imageResolution,
          videoRatio,
          videoResolution,
          videoDuration,
        });
        // router.push 本身不可等待；成功时保持锁与忙碌态直到页面卸载，
        // 避免慢导航窗口内再次点击而重复创建项目。
        if (!launched) {
          submitLockRef.current = false;
          setSubmitting(false);
        }
      } catch (error) {
        toast.error((error as Error)?.message || "创建画布失败，请重试");
        submitLockRef.current = false;
        setSubmitting(false);
      }
      return;
    }

    // 所有 Skill 都由助手 SkillRun 执行；快速栏自身只负责无 Skill 的单模型生成。
    if (selectedSkill) {
      toast.info("所选技能正在画布助手中执行");
      return;
    }
    if (!selectedModel) return;

    const canvasProjectId = projectId;
    if (!canvasProjectId) {
      toast.info("画布仍在加载，请稍后再试");
      return;
    }

    submitLockRef.current = true;
    optimizeSeqRef.current += 1;
    setSubmitting(true);
    const submittedPrompt = prompt;
    const submittedAttachmentIds = new Set(attachments.map((file) => file.id));
    try {
      const world = getViewportCenter?.();
      if (!world) throw new Error("画布视口尚未就绪");
      const snapshot = useCanvasStore.getState();
      if (snapshot.currentProjectId !== canvasProjectId) throw new Error("画布已切换，请重新提交");
      const nodePrompt = promptForConnectedNode(trimmedPrompt, usedRefs);
      const persistedTarget = variant === "consumer" && launchJournal
        ? snapshot.nodes.find((node) => node.id === launchJournal.targetNodeId)
        : undefined;
      const target = persistedTarget ?? createNode(mode, world.x, world.y, snapshot.nodes);
      if (!persistedTarget && variant === "consumer" && launchJournal) target.id = launchJournal.targetNodeId;
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
          };
      if (!persistedTarget) {
        Object.assign(target, {
          prompt: nodePrompt,
          status: "idle" as const,
          ...(activeRatio && activeRatio !== "auto" ? { aspectRatio: activeRatio } : {}),
          generationConfig,
        });
      }

      const addedNodes: CanvasNode[] = persistedTarget ? [] : [target];
      const fileNodeIds = new Map<string, string>();
      let uploadIndex = 0;
      for (const ref of usedRefs) {
        if (!ref.file || fileNodeIds.has(ref.file.id)) continue;
        const file = ref.file;
        const stableSourceId = variant === "consumer" ? launchJournal?.sourceNodeIds[file.id] : undefined;
        const persistedSource = stableSourceId
          ? snapshot.nodes.find((node) => node.id === stableSourceId)
          : undefined;
        if (persistedSource) {
          fileNodeIds.set(file.id, persistedSource.id);
          uploadIndex += 1;
          continue;
        }
        const sourceType = file.fileType === FileType.VIDEO
          ? "video"
          : file.mimeType?.startsWith("audio/")
            ? "audio"
            : "image";
        const sourceWorldX = world.x - 700;
        const sourceWorldY = world.y + uploadIndex * 390 - ((attachments.length - 1) * 195);
        const source = createNode(sourceType, sourceWorldX, sourceWorldY, [...snapshot.nodes, ...addedNodes]);
        if (stableSourceId) source.id = stableSourceId;
        source.title = file.originalName || source.title;
        source.status = "success";
        source.fileSize = file.fileSize;
        source.fileType = file.fileType;
        source.mimeType = file.mimeType;
        if (sourceType === "video") source.videoSrc = file.fileUrl;
        else if (sourceType === "audio") source.audioSrc = file.fileUrl;
        else source.imageSrc = file.fileUrl;
        addedNodes.push(source);
        fileNodeIds.set(file.id, source.id);
        uploadIndex += 1;
      }

      const connections: Connection[] = [];
      for (const ref of usedRefs) {
        const sourceId = ref.sourceNodeId ?? (ref.file ? fileNodeIds.get(ref.file.id) : undefined);
        const alreadyConnected = snapshot.connections.some((connection) =>
          connection.sourceId === sourceId && connection.targetId === target.id,
        );
        if (!sourceId || alreadyConnected || connections.some((connection) => connection.sourceId === sourceId)) continue;
        connections.push({
          id: variant === "consumer" && launchJournal
            ? `launch_conn_${launchJournal.id}_${sourceId}`
            : `conn_qs_${sourceId}_${target.id}`,
          sourceId,
          targetId: target.id,
        });
      }
      if (addedNodes.length || connections.length) {
        snapshot.addNodesAndConnections(addedNodes, connections, target.id);
      }

      if (variant === "consumer" && launchJournal) {
        const materialized = await requestCanvasSave(canvasProjectId);
        if (!materialized) {
          toast.error("新画布暂未保存，自动创作尚未开始");
          scheduleConsumerRetry("新画布保存仍未确认");
          return;
        }
      }

      if (!canvasMode) {
        toast.success("已添加待生成节点，可在节点中继续调整");
        if (variant === "consumer" && launchJournal) {
          clearCanvasLaunchJournal(launchJournal.id);
          onLaunchConsumed?.();
        }
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
        const audioURLs = usedRefs.filter((ref) => ref.kind === "audio" && ref.src).map((ref) => ref.src as string);
        const commonInput: Record<string, unknown> = {
          prompt: finalPrompt,
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
              ...(handler === "image_to_video" && imageURLs.length
                ? { sourceImage: imageURLs[0] }
                : imageURLs.length
                  ? { references: imageURLs }
                  : {}),
              ...(handler === "reference_to_video" && videoURLs.length ? { videoReferences: videoURLs } : {}),
              ...(handler === "reference_to_video" && audioURLs.length ? { audioReferences: audioURLs } : {}),
            };
        const computedPayload: CanvasLaunchGenerationPayload = {
          handler,
          modelId: selectedModel.modelId,
          input,
          ...(mode === "image" && modelConfig.gridOutput ? { gridOutput: true } : {}),
        };
        let generationPayload = computedPayload;
        if (variant === "consumer" && launchJournal) {
          const latestJournal = readCanvasLaunchJournal(launchJournal.id);
          generationPayload = latestJournal?.generationPayload ?? computedPayload;
          if (!latestJournal?.generationPayload) {
            const frozen = updateCanvasLaunchJournal(launchJournal.id, {
              state: "materialized",
              generationPayload: computedPayload,
              error: undefined,
            });
            if (!frozen) {
              toast.error("自动创作恢复信息保存失败，尚未发起生成");
              scheduleConsumerRetry("恢复信息仍未保存");
              return;
            }
            generationPayload = frozen.generationPayload ?? computedPayload;
          }
        }
        const readyState = useCanvasStore.getState();
        if (readyState.currentProjectId !== canvasProjectId || !readyState.nodes.some((node) => node.id === target.id)) {
          toast.info("启动节点已发生变化，正在重新准备");
          scheduleConsumerRetry("启动节点仍未准备完成");
          return;
        }
        const generationResult = await generate({
          nodeId: target.id,
          handler: generationPayload.handler,
          modelId: generationPayload.modelId,
          input: generationPayload.input,
          ...(variant === "consumer" && launchJournal ? { clientRequestId: launchJournal.clientRequestId } : {}),
          ...(generationPayload.gridOutput ? { gridOutput: true } : {}),
        });
        if (generationResult.status !== "started") {
          if (variant === "consumer" && launchJournal) {
            const ambiguous = generationResult.status === "ambiguous";
            updateCanvasLaunchJournal(launchJournal.id, ambiguous
              ? { state: "materialized", error: "生成结果尚未确认" }
              : { state: "failed", error: "生成请求未能启动，请在画布节点中重试" });
            await requestCanvasSave(canvasProjectId);
            if (ambiguous) scheduleConsumerRetry("生成结果仍待确认");
          } else if (generationResult.status === "rejected" && useCanvasStore.getState().currentProjectId === canvasProjectId) {
            for (const node of addedNodes) useCanvasStore.getState().removeNode(node.id, false);
          }
          return;
        }
        if (variant === "consumer" && launchJournal) {
          const taskId = generationResult.taskId;
          const acceptedState = useCanvasStore.getState();
          if (!acceptedState.nodes.some((node) => node.id === target.id)) {
            const availableNodeIds = new Set(acceptedState.nodes.map((node) => node.id));
            const restoredConnections: Connection[] = [];
            for (const ref of usedRefs) {
              const sourceId = ref.sourceNodeId ?? (ref.file ? fileNodeIds.get(ref.file.id) : undefined);
              if (!sourceId || !availableNodeIds.has(sourceId)) continue;
              if (acceptedState.connections.some((connection) =>
                connection.sourceId === sourceId && connection.targetId === target.id,
              )) continue;
              restoredConnections.push({
                id: `launch_conn_${launchJournal.id}_${sourceId}`,
                sourceId,
                targetId: target.id,
              });
            }
            acceptedState.addNodesAndConnections(
              [{ ...target, status: "generating", taskId }],
              restoredConnections,
              target.id,
            );
          } else {
            acceptedState.updateNode(target.id, { status: "generating", taskId }, false);
          }
          // startGeneration 会立即启动轮询；若目标节点恰在请求在途时被删除，
          // 首轮会按设计停止。节点恢复后显式续轮，避免任务永久停在 generating。
          resumeGeneration();
          const journalLinked = !!updateCanvasLaunchJournal(launchJournal.id, {
            state: "submitted",
            taskId,
            error: undefined,
          });
          if (!journalLinked) toast.info("任务已提交，正在改由画布保存任务号");
          const taskLinked = await requestCanvasSave(canvasProjectId);
          if (taskLinked) {
            clearCanvasLaunchJournal(launchJournal.id);
            onLaunchConsumed?.();
          } else {
            toast.info("任务已开始，画布正在等待保存确认");
            scheduleConsumerRetry("任务号仍未保存到画布");
          }
        }
      }

      setPrompt((current) => current === submittedPrompt ? "" : current);
      setAttachments((current) => current.filter((file) => !submittedAttachmentIds.has(file.id)));
    } catch (error) {
      toast.error((error as Error)?.message || "快速开始失败，请重试");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    if (
      variant !== "consumer" ||
      !persistenceReady ||
      !projectId ||
      !launchJournal ||
      launchJournal.projectId !== projectId ||
      launchSubmitNonce === 0 ||
      launchAttemptRef.current === launchSubmitNonce ||
      submitting ||
      uploading ||
      optimizing
    ) return;
    const frame = requestAnimationFrame(() => {
      if (launchAttemptRef.current === launchSubmitNonce) return;
      const durableJournal = readCanvasLaunchJournal(launchJournal.id) ?? launchJournal;
      const state = useCanvasStore.getState();
      const target = state.nodes.find((node) => node.id === durableJournal.targetNodeId);
      const durableTaskId = target?.taskId || (durableJournal.state === "submitted" ? durableJournal.taskId : undefined);
      if (target?.status === "success" || target?.status === "error") {
        launchAttemptRef.current = launchSubmitNonce;
        void requestCanvasSave(projectId).then((saved) => {
          if (!saved) {
            scheduleConsumerRetry("任务结果仍未保存到画布");
            return;
          }
          clearCanvasLaunchJournal(durableJournal.id);
          onLaunchConsumed?.();
        });
        return;
      }
      if (target && durableTaskId) {
        launchAttemptRef.current = launchSubmitNonce;
        state.updateNode(target.id, { status: "generating", taskId: durableTaskId }, false);
        updateCanvasLaunchJournal(durableJournal.id, {
          state: "submitted",
          taskId: durableTaskId,
          error: undefined,
        });
        void requestCanvasSave(projectId).then((saved) => {
          resumeGeneration();
          if (!saved) {
            scheduleConsumerRetry("任务号仍未保存到画布");
            return;
          }
          clearCanvasLaunchJournal(durableJournal.id);
          onLaunchConsumed?.();
        });
        return;
      }
      // preset/agent 的创建、恢复与产物落画布均由 CanvasAssistantPanel +
      // SkillRun runtime 接管，不能再落回普通模型校验或 direct generate。
      if (durableJournal.selectedSkill) {
        launchAttemptRef.current = launchSubmitNonce;
        return;
      }
      if (!modelsLoaded) return;
      if (modelsLoadError) {
        launchAttemptRef.current = launchSubmitNonce;
        if (launchRetryCountRef.current >= 3) {
          toast.info("模型列表仍未恢复，网络恢复后刷新画布可继续自动创作");
          return;
        }
        launchRetryCountRef.current += 1;
        launchRetryTimerRef.current = window.setTimeout(() => {
          launchRetryTimerRef.current = null;
          setModelsLoaded(false);
          setModelsLoadError(false);
          setModelsRetryNonce((current) => current + 1);
          setLaunchSubmitNonce((current) => current + 1);
        }, 1600 * launchRetryCountRef.current);
        return;
      }
      if (!selectedModel || selectedModel.modelId !== durableJournal.modelId) {
        launchAttemptRef.current = launchSubmitNonce;
        const error = "原先选择的模型当前不可用，已停止自动创作";
        updateCanvasLaunchJournal(durableJournal.id, { state: "failed", error });
        toast.error(error);
        return;
      }
      launchAttemptRef.current = launchSubmitNonce;
      if (durableJournal.state !== "failed") void submitRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    launchJournal,
    launchSubmitNonce,
    modelsLoaded,
    modelsLoadError,
    onLaunchConsumed,
    optimizing,
    persistenceReady,
    projectId,
    scheduleConsumerRetry,
    selectedModel,
    submitting,
    uploading,
    variant,
  ]);

  if (!expanded && variant === "canvas") {
    return (
      <button type="button" className={styles.collapsed} onClick={() => setExpanded(true)} aria-label="展开画布创作栏">
        <PencilLine aria-hidden className="h-4 w-4" />
        创作
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <section
      className={`${styles.root} ${isLauncher ? "dark" : ""}`}
      data-mode={mode}
      data-variant={variant}
      aria-label={isLauncher ? "新建画布创作栏" : "画布创作栏"}
      style={{ "--assistant-inset": `${assistantInset}px` } as CSSProperties}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className={styles.composer}>
        <div className={styles.editorWrap}>
          <div className={styles.editorRow}>
            {selectedSkill && (
              <SkillPromptChip
                skill={selectedSkill}
                onRemove={clearSelectedSkill}
                className={styles.inlineSkill}
              />
            )}
            <div className={styles.editorField}>
              <PromptRefEditor
                value={prompt}
                onChange={updatePrompt}
                refs={quickRefs}
                showThumbs={false}
                onSubmit={() => { void submit(); }}
                placeholder={isLauncher
                  ? "描述你的想法，可添加图片、视频或音频作为参考，用 / 使用技能"
                  : "描述你的想法，用 @ 引用画布里的图片、视频或音频"}
                ariaLabel={isLauncher ? "新画布创作描述" : "画布创作描述"}
                editorClassName={styles.editor}
                editorStyle={{ minHeight: isLauncher ? 64 : 58, maxHeight: 112 }}
              />
            </div>
          </div>
        </div>

        {activeRefCount > 0 && (
          <div className={styles.activeRefs}>
            {usedRefs.map((ref) => (
              <span key={ref.id} className={styles.refChip} title={`${refLabel(ref)} · ${ref.title}`}>
                {ref.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ref.thumb} alt="" />
                  : <span className={styles.refGlyph}>{refGlyph(ref)}</span>}
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
          <div className={styles.toolbarLeft} role="group" aria-label="模型与生成设置">
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || (!isLauncher && !projectId)}
              title="上传参考图片、视频或音频"
              aria-label="上传参考图片、视频或音频"
            >
              {uploading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
            </button>
            <input ref={fileInputRef} className="hidden" type="file" accept="image/*,video/*,audio/*" multiple onChange={handleUpload} />

            <div className={styles.modelControl}>
              {hasSkillSelection
                ? <span className={styles.unavailable}>技能自动编排</span>
                : modelsLoadError
                ? (
                  <button
                    type="button"
                    className={styles.modelRetry}
                    onClick={retryModels}
                    aria-label="模型加载失败，重新加载"
                  >
                    模型加载失败 · 重试
                  </button>
                )
                : !modelsLoaded
                  ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                  : selectableModels.length === 0
                    ? <span className={styles.unavailable}>{isLauncher ? "暂无可用视频模型" : "暂无可用模型"}</span>
                    : (
                      <ModelPicker
                        models={selectableModels}
                        value={selectedModel?.modelId ?? ""}
                        onChange={selectModel}
                        triggerLabel={isLauncher ? "视频模型" : "模型"}
                        showType={!isLauncher}
                        tone={isLauncher ? "dark" : "default"}
                      />
                    )}
            </div>

            {isLauncher && <div className={styles.skillControlWrap}>
              <button
                type="button"
                className={selectedSkill ? styles.skillActive : styles.controlButton}
                onClick={() => setSkillPickerOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={skillPickerOpen}
                title={selectedSkill ? `当前技能：${selectedSkill.title}` : "选择技能，也可以在输入框键入 /"}
              >
                <Wand2 aria-hidden className="h-3.5 w-3.5" />
                <span>{selectedSkill ? "技能 1" : "技能"}</span>
                <ChevronDown aria-hidden className="h-3 w-3" />
              </button>
            </div>}

            {!isAgentSelection && <>
              <QuickSelect
                label="比例"
                value={activeRatio}
                options={ratioOptions}
                onChange={mode === "image" ? setImageRatio : setVideoRatio}
                icon={<Ratio className="h-3.5 w-3.5" />}
                dark={isLauncher}
              />
              {mode === "image" ? (
              <>
                <QuickSelect
                  label="清晰度"
                  value={activeResolution}
                  options={resolutionOptions}
                  onChange={setImageResolution}
                  icon={<ScanLine className="h-3.5 w-3.5" />}
                  dark={isLauncher}
                />
                {qualityOptions.length > 1 && (
                  <QuickSelect
                    label="画质"
                    value={activeQuality}
                    options={qualityOptions}
                    onChange={setImageQuality}
                    dark={isLauncher}
                  />
                )}
              </>
              ) : (
              <>
                <QuickSelect
                  label="清晰度"
                  value={activeResolution}
                  options={resolutionOptions}
                  onChange={setVideoResolution}
                  icon={<ScanLine className="h-3.5 w-3.5" />}
                  dark={isLauncher}
                />
                <QuickSelect
                  label="时长"
                  value={String(activeDuration)}
                  options={durationOptions.map(String)}
                  onChange={(value) => setVideoDuration(Number(value))}
                  formatOption={(value) => `${value}s`}
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                  dark={isLauncher}
                />
              </>
              )}
            </>}

            {!isLauncher && (
              <div ref={refMenuWrapRef} className={styles.refMenuWrap}>
                <button
                  ref={refMenuTriggerRef}
                  type="button"
                  className={`${styles.controlButton} ${styles.refButton}`}
                  onClick={toggleRefMenu}
                  disabled={quickRefs.length === 0}
                  title={quickRefs.length ? "引用画布里的素材" : "画布里暂无可引用素材"}
                  aria-label={quickRefs.length ? `引用画布素材，已引用 ${activeRefCount} 项` : "画布里暂无可引用素材"}
                  aria-haspopup="menu"
                  aria-expanded={refMenuOpen}
                  aria-controls="canvas-quick-start-ref-menu"
                >
                  <AtSign aria-hidden className="h-4 w-4" />
                  {activeRefCount > 0 && <span className={styles.countBadge}>{activeRefCount}</span>}
                </button>
              </div>
            )}
          </div>

          <div className={styles.toolbarRight} role="group" aria-label="执行设置">
            {uploading && <span className={styles.progress} aria-live="polite"><Paperclip aria-hidden className="h-3.5 w-3.5" /> {uploadProgress}%</span>}
            <button
              type="button"
              role="switch"
              aria-checked={canvasMode}
              aria-label={selectedSkill ? "所选技能将在新画布助手中运行" : canvasMode ? "画布模式已开启，创建画布后立即生成" : "画布模式已关闭，仅创建待生成节点"}
              className={styles.canvasToggle}
              title={selectedSkill ? "技能会在新画布的助手中运行" : isLauncher ? "控制新画布打开后是否立即生成" : "关闭后只添加待生成节点，方便继续精调"}
              onClick={() => setCanvasMode((current) => !current)}
              disabled={!!selectedSkill}
            >
              <span>画布模式</span>
              <span className={canvasMode ? styles.switchOn : styles.switchOff} aria-hidden>
                <span />
              </span>
            </button>
            <button
              type="button"
              className={styles.optimizeButton}
              onClick={() => { void optimizePrompt(); }}
              disabled={!prompt.trim() || optimizing || submitting}
              title="AI 优化提示词"
              aria-label="AI 优化提示词"
            >
              {optimizing ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <PencilLine aria-hidden className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className={styles.submitButton}
              onClick={() => { void submit(); }}
              disabled={launchBlocked || submitting || uploading || optimizing || !prompt.trim() || (!isLauncher && !projectId) || !canvasLaunchCanSubmit(selectedSkill, directModelId) || (!isLauncher && hasSkillSelection)}
              title={launchBlocked ? launchBlockedReason : submitting ? isLauncher ? "正在创建新画布" : "正在提交生成" : submitActionLabel}
              aria-label={launchBlocked ? launchBlockedReason : submitting ? isLauncher ? "正在创建新画布" : "正在提交生成" : submitActionLabel}
              aria-busy={submitting}
            >
              {submitting ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <ArrowUp aria-hidden className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {refMenuOpen && typeof document !== "undefined" && createPortal(
        <div
          id="canvas-quick-start-ref-menu"
          ref={refMenuPanelRef}
          className={`${styles.refMenu} ${refMenuPosition.openUp ? styles.refMenuOpenUp : ""}`}
          role="menu"
          aria-label="引用画布素材"
          style={{ left: refMenuPosition.left, top: refMenuPosition.top, maxHeight: refMenuPosition.maxHeight }}
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
                  updatePrompt(`${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${refLabel(ref)} `);
                  setRefMenuOpen(false);
                  refMenuTriggerRef.current?.focus();
                }}
              >
                {ref.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ref.thumb} alt="" />
                  : <span className={styles.refGlyph}>{refGlyph(ref)}</span>}
                <span><strong>{ref.title || refLabel(ref)}</strong><small>{refLabel(ref)}</small></span>
                {active && <span className={styles.usedMark}>已引用</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}

      {isLauncher && <SkillPicker
        open={skillPickerOpen}
        onClose={() => setSkillPickerOpen(false)}
        onPick={pickSkill}
        currentId={selectedSkill?.id}
        kinds={["preset", "agent"]}
        entryPoint="canvas"
        targetType={mode}
        outputType={mode}
      />}
    </section>
  );
}
