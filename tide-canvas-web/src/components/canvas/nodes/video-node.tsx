"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvasStore, generateNodeId } from "@/stores/use-canvas-store";
import { Video, Upload, Camera, Loader2, Play, Pause, Download, Maximize2, Zap, Layers, Sparkles, Copy, Clapperboard, ScanLine } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { parseRatio } from "./quality-ratio-picker";
import { VideoParamPicker, normalizeDurations, type VideoParamValue } from "./video-param-picker";
import { ModelPicker } from "./model-picker";
import { uploadFileSmart } from "@/lib/api";
import { resolveModelReferenceCountLimit, resolveModelReferenceLimitBytes } from "@/lib/upload-limits";
import { resolveVideoPointCost } from "@/lib/price-matrix";
import { isConceptCanvasNodeType, isImageReferenceNodeType } from "@/lib/canvas-node-types";
import { AiModelType, type ClipReshootRequest } from "@/types/ai";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodeChrome } from "./base/node-chrome";
import { VideoModeDropdown } from "./video-mode-dropdown";
import { PromptRefEditor, PromptEditorModal } from "./prompt-ref-editor";
import { type RefItem } from "./prompt-ref-utils";
import type { CanvasNodeProps } from "./types/node-props";
import { useAiModels, useMediaErrorRecovery, useNodePrompt, useNodeRuntime, useSyncContentSize } from "./shared/use-node-runtime";
import { useMediaUpload } from "./shared/use-media-upload";
import { useFileDownload } from "./shared/use-file-download";
import { ConfigurableNodeToolbar, type ConfigurableNodeToolbarAction } from "./shared/configurable-node-toolbar";
import { useCanvasNodeFeatures } from "@/stores/use-canvas-node-config-store";
import { findRightColumnSpot, getIncomingSources, inlineIncomingTextRefs, parseModelConfig, stopEvent as stop, validateReferenceFileSizes } from "./shared/node-utils";
import { GenerateSubmitButton, NodeDimsBadge, NodeErrorBadge, NodeGeneratingOverlay, NodeMediaLightbox, NodePanelChrome, NodeShell, NodeUploadingOverlay } from "./shared/node-overlays";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import { useReferenceVideoQuote } from "@/hooks/use-reference-video-quote";
import { supportsOmniReference } from "@/lib/omni-reference";
import type { ModelConfig } from "@/types/admin-models";
import {
  CLIP_RESHOOT_DEFAULT_SECONDS,
  buildClipReshootRangeInstruction,
  buildClipReshootNode,
  buildNativeClipReshootInstruction,
  clipReshootProviderDuration,
  formatClipReshootTime,
  normalizeClipReshootRanges,
  remapClipReshootPromptTimecodes,
  selectClipReshootModel,
  supportsTimestampVideoEdit,
  supportsVideoReference,
  validateClipReshootPrompt,
} from "./video-clip-reshoot";
import { VideoClipReshootTimeline } from "./video-clip-reshoot-timeline";
import { BREAKDOWN_NODE_HEIGHT, BREAKDOWN_NODE_WIDTH } from "./video-frame-breakdown";

// 各模式（Tab）对连接源节点的数量/类型限制：hover 时提示，生成时校验。文生视频无需连接。
// max 只是没有后台配置时的兜底；模型在「模型管理」里配了参考素材数量时以配置为准
// （见 refCountOverflow），否则后台改了限制画布节点也不会跟着变。
const TAB_LIMITS: Record<string, { hint: string; min: number; max: number; types: string[] }> = {
  "全能参考": { hint: "需要连接图片/视频/音频节点（1~15 个）", min: 1, max: 15, types: ["image", "video", "audio"] },
  "图生视频": { hint: "需要连接图片节点（1 个）", min: 1, max: 1, types: ["image"] },
  "首尾帧": { hint: "需要连接图片节点（1~2 个）", min: 1, max: 2, types: ["image"] },
  "图片参考": { hint: "需要连接图片节点（1~9 个）", min: 1, max: 9, types: ["image"] },
};

type RefCountKind = "image" | "video" | "audio";
const REF_COUNT_KINDS: RefCountKind[] = ["image", "video", "audio"];
const REF_KIND_LABELS: Record<RefCountKind, string> = {
  image: "参考图片",
  video: "参考视频",
  audio: "参考音频",
};

// 全部模式 Tab 及其对应后端 handler；模型在后台勾选了 supportedHandlers 时只显示对应 Tab
const ALL_TABS: string[] = ["文生视频", "全能参考", "图生视频", "首尾帧", "图片参考"];
const TAB_HANDLER: Record<string, string> = {
  "文生视频": "text_to_video",
  "图生视频": "image_to_video",
  "首尾帧": "start_end_to_video",
  "图片参考": "reference_to_video",
  "全能参考": "reference_to_video",
};

/** 秒数显示：保留 1 位小数，如 1.9s */
function fmtSec(t: number): string {
  return `${(t || 0).toFixed(1)}s`;
}

/** 播放（优先带声；被自动播放策略拦截则静音重试）；从结尾重新进入则回到开头 */
function playVideo(v: HTMLVideoElement) {
  if (v.ended) v.currentTime = 0;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
}

/**
 * 用隐藏的跨域 video 抓取 {@code src} 在 {@code time} 秒处的帧为 PNG Blob。
 * 仅用于截图，不影响可见视频；若上游未开启 GET 跨域(CORS) 导致 canvas 被污染或加载失败，返回 null。
 */
function grabFrame(src: string, time: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      v.load();
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.onerror = () => { clearTimeout(timer); finish(null); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(time, Math.max(0, (v.duration || time) - 0.01)); };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        if (!ctx || !c.width || !c.height) { clearTimeout(timer); finish(null); return; }
        ctx.drawImage(v, 0, 0);
        c.toBlob((b) => { clearTimeout(timer); finish(b); }, "image/png");
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };
    v.src = src;
  });
}

const VIDEO_CARD_MAX_WIDTH = 608;
const VIDEO_CARD_MAX_HEIGHT = 420;

function fixedRatioWidth(aspect: number): number | null {
  if (Math.abs(aspect - 9 / 16) < 0.001) return 345;
  if (Math.abs(aspect - 1 / 2) < 0.001) return 350;
  if (Math.abs(aspect - 2) < 0.001) return 694;
  return null;
}

function fitVideoCardSize(aspect: number, maxW = VIDEO_CARD_MAX_WIDTH, maxH = VIDEO_CARD_MAX_HEIGHT) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const fixedW = fixedRatioWidth(safeAspect);
  if (fixedW != null) {
    return { w: fixedW, h: Math.round(fixedW / safeAspect) };
  }
  const heightAtMaxWidth = maxW / safeAspect;
  if (heightAtMaxWidth <= maxH) {
    return { w: maxW, h: Math.round(heightAtMaxWidth) };
  }
  return { w: Math.round(maxH * safeAspect), h: maxH };
}

const VIDEO_CACHE = "tc-video-v1";

/** 只查本地缓存（不发起下载）；命中返回本地 blob URL，否则 null */
async function matchCachedVideo(url: string): Promise<string | null> {
  try {
    if (typeof caches === "undefined") return null;
    const cache = await caches.open(VIDEO_CACHE);
    const resp = await cache.match(url);
    if (!resp) return null;
    const blob = await resp.blob();
    return blob && blob.size > 0 ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/** 查缓存；未命中则跨域下载一次并写入 Cache Storage，返回本地 blob URL（跨域被拒/失败则 null，由调用方回退原生播放） */
async function fetchAndCacheVideo(url: string): Promise<string | null> {
  try {
    if (typeof caches === "undefined") return null;
    const cache = await caches.open(VIDEO_CACHE);
    let resp = await cache.match(url);
    if (!resp) {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return null;
      await cache.put(url, r.clone());
      resp = r;
    }
    const blob = await resp.blob();
    return blob && blob.size > 0 ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export const VideoNode = memo(function VideoNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: CanvasNodeProps) {
  const configuredFeatures = useCanvasNodeFeatures(node.type);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { generate, generating, showAuxUI } = useNodeRuntime(node, isSelected, isDragging);
  const isClipReshoot = node.videoOperation === "clip_reshoot";
  const clipSourceVideo = useCanvasStore((state) => {
    if (!isClipReshoot) return undefined;
    if (node.clipReshootSourceId) {
      const connected = state.connections.some((candidate) =>
        candidate.targetId === node.id && candidate.sourceId === node.clipReshootSourceId
      );
      if (!connected) return undefined;
      return state.nodes.find((source) =>
        source.id === node.clipReshootSourceId && source.type === "video" && source.videoSrc
      );
    }
    const connection = state.connections.find((candidate) =>
      candidate.targetId === node.id
      && state.nodes.some((source) => source.id === candidate.sourceId && source.type === "video" && source.videoSrc),
    );
    return connection
      ? state.nodes.find((source) => source.id === connection.sourceId && source.type === "video" && source.videoSrc)
      : undefined;
  });
  const playerVideoSrc = node.videoSrc || clipSourceVideo?.videoSrc || "";
  const [videoParam, setVideoParam] = useState<VideoParamValue>({
    ratio: node.aspectRatio ?? "16:9",
    resolution: node.generationConfig?.resolution ?? "720P",
    duration: node.generationConfig?.duration ?? 5,
    audio: true,
  });
  const { models: videoModels, modelId: selectedModelId, setModelId: setSelectedModelId, selectedModel } = useAiModels(
    AiModelType.VIDEO,
    node.generationConfig?.modelId,
  );
  const rawConfig = parseModelConfig<ModelConfig & { audio?: boolean }>(selectedModel);
  const omniImageSupported = supportsOmniReference(rawConfig, "image");
  const omniVideoSupported = supportsOmniReference(rawConfig, "video");
  const omniAudioSupported = supportsOmniReference(rawConfig, "audio");
  const selectableVideoModels = isClipReshoot
    ? videoModels.filter(supportsVideoReference)
    : videoModels;
  const clipReshootModelReady = !isClipReshoot || (!!selectedModel && supportsVideoReference(selectedModel));
  const clipReshootSourceReady = !isClipReshoot || !!clipSourceVideo;
  const [videoTab, setVideoTab] = useState(isClipReshoot ? "全能参考" : "文生视频");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [clipSourceThumbnail, setClipSourceThumbnail] = useState<{ src: string; thumbnail: string } | null>(null);
  const { promptExpanded, setPromptExpanded, handlePromptChange } = useNodePrompt(node, node.videoSrc);
  const { downloading, download: handleDownload } = useFileDownload();
  const {
    fileInputRef,
    openFilePicker,
    handleFileUpload,
    nodeUploading,
    nodeUploadPct,
    uploadPreviewSrc,
    dims: videoDims,
    setDims: setVideoDims,
    mountedRef,
  } = useMediaUpload(node, "video", selectedModel);
  // 自定义播放器：hover 播放 / 离开暂停 + 进度条 + 截图
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);
  // 本地缓存：首次播放下载一次写入 Cache Storage，之后从本地 blob 播放，省流量
  const [srcToUse, setSrcToUse] = useState<string>(playerVideoSrc);
  const [resolved, setResolved] = useState<null | "blob" | "native">(null);
  const [hovering, setHovering] = useState(false);
  const objUrlRef = useRef<string | null>(null);
  const resolvingRef = useRef(false);
  const playerVideoSrcRef = useRef(playerVideoSrc);
  useMediaErrorRecovery(node, node.videoSrc, generating);

  // 片段重拍只能走视频参考模型；恢复旧画布或后台调整模型能力后也自动收敛到可用模型。
  useEffect(() => {
    if (!isClipReshoot || (selectedModel && supportsVideoReference(selectedModel))) return;
    const replacement = selectClipReshootModel(videoModels, selectedModelId);
    if (replacement && replacement.modelId !== selectedModelId) setSelectedModelId(replacement.modelId);
  }, [isClipReshoot, selectedModel, selectedModelId, setSelectedModelId, videoModels]);

  // ===== 引用（@ 提及）系统：入边源节点 → 可内联引用的「图片N」/「视频N」 =====
  const refsSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => {
        const src = s.nodes.find((n) => n.id === c.sourceId);
        if (src && isImageReferenceNodeType(src.type) && src.imageSrc) return "i~" + src.id + "~" + src.imageSrc + "~" + (src.title || "");
        if (src && src.type === "video" && src.videoSrc) return "v~" + src.id + "~" + src.videoSrc + "~" + (src.title || "");
        if (src && src.type === "audio" && src.audioSrc) return "a~" + src.id + "~" + src.audioSrc + "~" + (src.title || "");
        if (src && src.type === "text" && src.content) return "t~" + src.id + "~" + src.content + "~" + (src.title || "");
        return "";
      })
      .filter(Boolean)
      .join("|")
  );
  const refs = useMemo<RefItem[]>(() => {
    const st = useCanvasStore.getState();
    // 三类各自从 1 起编号，且都按 st.connections 的遍历序——handleGenerate 里的
    // sources 用的是同一个顺序，imageUrls / videoUrls / textNodes 由它 filter 而来，
    // 因此「图片N」严格对齐第 N 张参考图、「视频N」对齐第 N 个参考视频、
    // 「文本N」对齐第 N 个文本节点。
    const images: RefItem[] = [];
    const videos: RefItem[] = [];
    const audios: RefItem[] = [];
    const texts: RefItem[] = [];
    for (const c of st.connections) {
      if (c.targetId !== node.id) continue;
      const src = st.nodes.find((n) => n.id === c.sourceId);
      if (!src) continue;
      if (isImageReferenceNodeType(src.type) && src.imageSrc) {
        images.push({ id: src.id, thumb: src.imageSrc, title: src.title || "", index: images.length + 1, kind: "image", src: src.imageSrc });
      } else if (src.type === "video" && src.videoSrc) {
        // 片段重拍复用时间轴抽取的首张帧；其它视频没有封面时走 ▶ 降级字形。
        videos.push({
          id: src.id,
          thumb: clipSourceThumbnail?.src === src.videoSrc ? clipSourceThumbnail.thumbnail : "",
          title: src.title || "",
          index: videos.length + 1,
          kind: "video",
          src: src.videoSrc,
        });
      } else if (src.type === "audio" && src.audioSrc) {
        audios.push({
          id: src.id,
          thumb: "",
          title: src.title || "",
          index: audios.length + 1,
          kind: "audio",
          src: src.audioSrc,
        });
      } else if (src.type === "text" && src.content?.trim()) {
        texts.push({ id: src.id, thumb: "", title: src.title || "", index: texts.length + 1, kind: "text", text: src.content });
      }
    }
    // 只有「全能参考」会把 videoReferences 下发给模型；其余模式下入边视频根本不参与
    // 生成，给它编号等于让用户引用一个模型收不到的东西。
    // 文本不占模型的参考位（正文直接拼进 prompt），所以各模式一律可引用。
    const visibleImages = videoTab === "图片参考"
      ? omniImageSupported ? images : []
      : videoTab === "全能参考"
        ? omniImageSupported ? images : []
        : images;
    const visibleVideos = videoTab === "全能参考" && omniVideoSupported ? videos : [];
    const visibleAudios = videoTab === "全能参考" && omniAudioSupported ? audios : [];
    return [...visibleImages, ...visibleVideos, ...visibleAudios, ...texts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSourceThumbnail, refsSig, node.id, omniAudioSupported, omniImageSupported, omniVideoSupported, videoTab]);
  const clipSourceRefIndex = refs.find((ref) => ref.kind === "video" && ref.id === clipSourceVideo?.id)?.index ?? 1;
  const hasConceptPrompt = useCanvasStore((s) =>
    s.connections.some((c) => {
      if (c.targetId !== node.id) return false;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      return !!src && isConceptCanvasNodeType(src.type) && !!src.prompt?.trim();
    })
  );
  // 入边文本、角色或场景设定会拼进 prompt，所以输入框空着照样有提示词可发。
  const hasPromptSource = !!node.prompt?.trim() || refs.some((r) => r.kind === "text") || hasConceptPrompt;
  // 实时统计连接到本节点的「有素材」源节点数（图片/视频），用于按模式启用/禁用 Tab
  const connSig = useCanvasStore((s) => {
    let img = 0;
    let vid = 0;
    let aud = 0;
    for (const c of s.connections) {
      if (c.targetId !== node.id) continue;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      if (src && isImageReferenceNodeType(src.type) && src.imageSrc) img++;
      else if (src?.type === "video" && src.videoSrc) vid++;
      else if (src?.type === "audio" && src.audioSrc) aud++;
    }
    return `${img},${vid},${aud}`;
  });
  const [imgCount, vidCount, audCount] = connSig.split(",").map(Number);
  // 该模式下某类素材是否被模型关闭（关掉的类型根本不下发，不参与数量校验）
  const refKindEnabled = (t: string, kind: RefCountKind) => {
    if (t !== "全能参考" && t !== "图片参考") return true;
    return kind === "image" ? omniImageSupported : kind === "video" ? omniVideoSupported : omniAudioSupported;
  };
  // 数量以后台「模型管理」配置为准：返回第一个超出该模型上限的素材类型。
  // 未配置（0）时返回 null，由 TAB_LIMITS 的协议兜底继续生效。
  const refCountOverflow = (
    t: string,
    counts: Record<RefCountKind, number>,
  ): { label: string; limit: number; count: number } | null => {
    const lim = TAB_LIMITS[t];
    if (!lim) return null;
    for (const kind of REF_COUNT_KINDS) {
      if (!lim.types.includes(kind) || !refKindEnabled(t, kind)) continue;
      const limit = resolveModelReferenceCountLimit(selectedModel, kind, TAB_HANDLER[t]);
      if (limit && counts[kind] > limit) {
        return { label: REF_KIND_LABELS[kind], limit, count: counts[kind] };
      }
    }
    return null;
  };
  const connectedRefCounts: Record<RefCountKind, number> = { image: imgCount, video: vidCount, audio: audCount };
  // 模式不可选时的原因提示：被模型配置挡住就说清是哪一类超了，别再显示协议兜底区间
  const tabHint = (t: string) => {
    const overflow = refCountOverflow(t, connectedRefCounts);
    if (overflow) return `所选模型最多支持 ${overflow.limit} 个${overflow.label}（已连接 ${overflow.count} 个）`;
    return TAB_LIMITS[t]?.hint;
  };
  // 某模式 Tab 是否可选：连接的合格素材数落在 [min,max] 且不超过模型配置的数量上限
  //（文生视频无需连接，恒可选）
  const tabEnabled = (t: string) => {
    if (t === "图片参考" && !omniImageSupported) return false;
    const lim = TAB_LIMITS[t];
    if (!lim) return true;
    let m = 0;
    if (lim.types.includes("image") && (t !== "全能参考" || omniImageSupported)) m += imgCount;
    if (lim.types.includes("video") && (t !== "全能参考" || omniVideoSupported)) m += vidCount;
    if (lim.types.includes("audio") && (t !== "全能参考" || omniAudioSupported)) m += audCount;
    if (m < lim.min || m > lim.max) return false;
    return !refCountOverflow(t, connectedRefCounts);
  };
  // 当前选中视频模型 → 解析 config（限定清晰度/比例/时长/音频）→ 差异化计费
  // 模型支持的模式 Tab：后台对模型勾选了 supportedHandlers 时只显示对应模式；未配置 = 全部
  const modelHandlers = selectedModel?.supportedHandlers;
  const modelCapabilitySignature = `${selectedModelId}:${modelHandlers?.join(",") ?? "*"}:${omniImageSupported}:${omniVideoSupported}:${omniAudioSupported}`;
  const visibleTabs = isClipReshoot
    ? (selectedModel && supportsVideoReference(selectedModel) ? ["全能参考"] : [])
    : ALL_TABS.filter(
        (t) => {
          if (modelHandlers?.length && !modelHandlers.includes(TAB_HANDLER[t])) return false;
          if (t === "图片参考") return omniImageSupported;
          if (t === "全能参考") return omniImageSupported || omniVideoSupported || omniAudioSupported;
          return true;
        },
      );
  // 时长在后台存成带单位、可能乱序的字符串("4s")；规整成升序秒数供选择器/校正/生成
  // 统一按数字处理。durations 显式为空数组时保持"无此维度"语义(不回退默认档)。
  const formatConfig = {
    ...rawConfig,
    durations: rawConfig.durations ? normalizeDurations(rawConfig.durations) : undefined,
  };
  const clipTimelineVisible = isClipReshoot && !!clipSourceVideo?.videoSrc;
  // 逐级回退必须过"正数"闸:播放器 duration 在元数据加载前是 0,mediaDuration
  // 也可能存到 0——0 不是 nullish,裸 ?? 链会在 0 处停住,把后面的真实时长全部
  // 挡掉(选区被钳到默认 5 秒)。
  const positiveSecondsOf = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const clipSourceDuration = positiveSecondsOf(clipSourceVideo?.mediaDuration)
    ?? (node.videoSrc ? undefined : positiveSecondsOf(duration))
    ?? positiveSecondsOf(clipSourceVideo?.generationConfig?.duration)
    ?? positiveSecondsOf(node.generationConfig?.duration)
    ?? CLIP_RESHOOT_DEFAULT_SECONDS;
  const clipRanges = useMemo(
    () => normalizeClipReshootRanges(node.clipReshootRanges, clipSourceDuration),
    [clipSourceDuration, node.clipReshootRanges],
  );
  // 原生时间戳编辑管线(Seedance 2.5 一类,模型 Config 显式 timestampVideoEdit):
  // 全片直发 + 原片时间码指令,跳过服务端裁剪/拼接。两种情况自动降级回 ffmpeg
  // 裁拼路径(功能不中断):① 原视频超出模型单次生成档位;② 源时长只剩兜底
  // 默认值(元数据缺失)——裁拼路径的选区会被服务端 ffprobe 实测复核,原生路径
  // 没有这道复核,错误时长会把钳错的时间码静默写进指令,必须以可信时长为前提。
  const positiveMediaSeconds = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  };
  const clipSourceDurationTrusted = positiveMediaSeconds(clipSourceVideo?.mediaDuration)
    || (!node.videoSrc && positiveMediaSeconds(duration))
    || positiveMediaSeconds(clipSourceVideo?.generationConfig?.duration);
  const nativeClipReshoot = isClipReshoot
    && !!selectedModel
    && supportsTimestampVideoEdit(selectedModel)
    && clipSourceDurationTrusted
    && (!formatConfig.durations?.length
      || formatConfig.durations.some((candidate) => candidate >= Math.ceil(clipSourceDuration)));
  const generationDuration = isClipReshoot
    ? nativeClipReshoot
      ? Math.max(1, Math.ceil(clipSourceDuration))
      : clipReshootProviderDuration(clipRanges, clipSourceDuration)
    : videoParam.duration;
  const providerGenerationDuration = isClipReshoot && formatConfig.durations?.length
    ? formatConfig.durations.find((candidate) => candidate >= generationDuration) ?? generationDuration
    : generationDuration;
  const clipReshootRequest = useMemo<ClipReshootRequest | undefined>(() => (
    isClipReshoot && !nativeClipReshoot && clipSourceVideo?.videoSrc
      ? { sourceUrl: clipSourceVideo.videoSrc, ranges: clipRanges }
      : undefined
  ), [clipRanges, clipSourceVideo?.videoSrc, isClipReshoot, nativeClipReshoot]);
  // 积分显示与服务端 resolveCost 同口径：按次模式只按清晰度取价且完全
  // 忽略时长；按时长模式继续查「时长 × 清晰度」矩阵和旧 modifier。
  const referenceVideoUrls = useMemo(() => {
    if (videoTab !== "全能参考" || !omniVideoSupported) return [];
    const state = useCanvasStore.getState();
    return getIncomingSources(state, node.id)
      .filter((source) => source.type === "video" && source.videoSrc)
      .map((source) => source.videoSrc as string);
    // refsSig intentionally invalidates this imperative store snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSourceThumbnail, refsSig, node.id, omniVideoSupported, videoTab]);
  const referenceVideoQuote = useReferenceVideoQuote(
    selectedModel?.modelId || selectedModel?.id,
    rawConfig,
    videoParam.resolution,
    referenceVideoUrls,
    clipReshootRequest,
  );
  const basePointCost = resolveVideoPointCost(
    formatConfig,
    providerGenerationDuration,
    videoParam.resolution,
    selectedModel?.pointCost ?? 135,
  );
  const pointCost = basePointCost + referenceVideoQuote.quote.pointCost;

  // 切换模型后当前比例/清晰度/时长不在该模型的可选档位 → 自动校正为其首个档位
  useEffect(() => {
    setVideoParam((p) => {
      let next = p;
      const { ratios, resolutions, durations } = formatConfig;
      if (ratios?.length && !ratios.includes(p.ratio)) next = { ...next, ratio: ratios[0] };
      // 清晰度大小写容错(后台 "720p" vs 默认 "720P")：不区分大小写地判定是否需校正。
      if (resolutions?.length && !resolutions.some((r) => r.toLowerCase() === p.resolution.toLowerCase())) next = { ...next, resolution: resolutions[0] };
      // durations 已由 normalizeDurations 规整成升序数字，直接取首个即最短时长。
      if (durations?.length && !durations.includes(p.duration)) next = { ...next, duration: durations[0] };
      return next;
    });
    // formatConfig 由 selectedModelId 派生(引用每次渲染变化)，不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

  // 视频卡片按所选比例渲染，缩放时维持比例
  const ratioParsed = parseRatio(videoParam.ratio);
  const cardAspect = ratioParsed ? ratioParsed.w / ratioParsed.h : 16 / 9;
  const { w: cardW, h: cardHeight } = fitVideoCardSize(cardAspect);
  const promptPanelW = Math.max(640, cardW + 32);
  const mediaContentHeight = cardHeight + (clipTimelineVisible ? 86 : 0);
  const handleClipSourceThumbnail = useCallback((thumbnail: string) => {
    if (!clipSourceVideo?.videoSrc) return;
    setClipSourceThumbnail({ src: clipSourceVideo.videoSrc, thumbnail });
  }, [clipSourceVideo?.videoSrc]);

  // 卡片实际渲染尺寸同步 store（连线锚点、整理布局与图片节点一致对齐）
  useSyncContentSize(node, cardW, mediaContentHeight);

  // 换源时重置缓存解析；若本地已缓存则直接用 blob（刷新/重挂也免下载）
  useEffect(() => {
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    playerVideoSrcRef.current = playerVideoSrc;
    setSrcToUse(playerVideoSrc);
    setDuration(0);
    setCurrentTime(0);
    setResolved(null);
    if (!playerVideoSrc) return;
    let cancelled = false;
    void matchCachedVideo(playerVideoSrc).then((blobUrl) => {
      if (cancelled) { if (blobUrl) URL.revokeObjectURL(blobUrl); return; }
      if (blobUrl) { objUrlRef.current = blobUrl; setSrcToUse(blobUrl); setResolved("blob"); }
    });
    return () => { cancelled = true; };
  }, [playerVideoSrc]);

  // 卸载回收 blob URL
  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  // 悬停且源已就绪 → 播放（首次悬停先下载并缓存，仅下载一次）
  useEffect(() => {
    if (hovering && resolved && videoRef.current) playVideo(videoRef.current);
  }, [hovering, resolved, srcToUse]);

  // 当前模式因连接变化而不再满足条件时，回退到无连接要求的模式。
  // 回退目标必须在 visibleTabs 内:否则与下面「模式不被模型支持 → 回退」的
  // effect 互相打架(A 设「文生视频」→ B 发现不可见设回 → A 再设……),
  // 在仅支持 i2v 的模型 + 无连接素材时会进入 setState 死循环卡死页面。
  useEffect(() => {
    if (isClipReshoot) {
      if (videoTab !== "全能参考") setVideoTab("全能参考");
      return;
    }
    const lim = TAB_LIMITS[videoTab];
    if (!lim) return;
    let m = 0;
    if (lim.types.includes("image") && (videoTab !== "全能参考" || omniImageSupported)) m += imgCount;
    if (lim.types.includes("video") && (videoTab !== "全能参考" || omniVideoSupported)) m += vidCount;
    if (lim.types.includes("audio") && (videoTab !== "全能参考" || omniAudioSupported)) m += audCount;
    if (m < lim.min || m > lim.max || refCountOverflow(videoTab, connectedRefCounts)) {
      const fallback = visibleTabs.find((t) => !TAB_LIMITS[t]);
      // 该模型没有任何无门槛模式时保持现状,仅靠发送按钮禁用挡住提交
      if (fallback && fallback !== videoTab) setVideoTab(fallback);
    }
    // visibleTabs 由 selectedModelId 派生(数组引用每次渲染变化),不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audCount, imgCount, isClipReshoot, modelCapabilitySignature, omniAudioSupported, omniImageSupported, omniVideoSupported, vidCount, videoTab]);

  // 切换模型后当前模式不被该模型支持 → 回退到其第一个可用模式
  useEffect(() => {
    if (!visibleTabs.includes(videoTab)) {
      setVideoTab(visibleTabs[0] ?? "文生视频");
    }
    // visibleTabs 由 selectedModelId 派生，避免数组引用作为依赖反复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelCapabilitySignature, videoTab]);

  // 上升沿自动升级：从「无连接素材」变为「有素材」时，若仍停留在默认的「文生视频」，自动切到
  // 「全能参考」——否则 text_to_video 不会把连上的参考图喂给上游，参考图形同虚设。仅在 0→有 的
  // 跳变时切换，故用户之后手动改回「文生视频」不会被反复纠正。
  const prevHasMaterialRef = useRef(false);
  useEffect(() => {
    const material = (omniImageSupported ? imgCount : 0)
      + (omniVideoSupported ? vidCount : 0)
      + (omniAudioSupported ? audCount : 0);
    const hasMaterial = material > 0;
    if (hasMaterial && !prevHasMaterialRef.current && videoTab === "文生视频" && material <= 15
        && visibleTabs.includes("全能参考")) {
      setVideoTab("全能参考");
    }
    prevHasMaterialRef.current = hasMaterial;
    // visibleTabs 为派生数组(引用每次渲染变化)，上升沿 guard 已防止重复切换，不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audCount, imgCount, omniAudioSupported, omniImageSupported, omniVideoSupported, vidCount, videoTab]);

  // 切换模型后，把视频参数收敛到该模型 config 允许的清晰度/比例/时长/音频，避免下发非法值
  useEffect(() => {
    if (!selectedModel) return;
    setVideoParam((prev) => {
      const next = { ...prev };
      if (formatConfig.resolutions?.length && !formatConfig.resolutions.some((r) => r.toLowerCase() === next.resolution.toLowerCase())) next.resolution = formatConfig.resolutions[0];
      if (formatConfig.ratios?.length && !formatConfig.ratios.includes(next.ratio)) next.ratio = formatConfig.ratios[0];
      if (formatConfig.durations?.length && !formatConfig.durations.includes(next.duration)) next.duration = formatConfig.durations[0];
      if (formatConfig.audio === false) next.audio = false;
      return next.resolution === prev.resolution && next.ratio === prev.ratio && next.duration === prev.duration && next.audio === prev.audio ? prev : next;
    });
    // 仅在切换模型时收敛；formatConfig 随 selectedModelId 派生，无需进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

  // 首次需要播放时：查/建本地缓存→用 blob；跨域不可用则回退原生 src。解析完成由 effect 触发播放。
  const ensureResolved = useCallback(async () => {
    if (resolved || resolvingRef.current || !playerVideoSrc) return;
    resolvingRef.current = true;
    const requestedSrc = playerVideoSrc;
    const blobUrl = await fetchAndCacheVideo(requestedSrc);
    resolvingRef.current = false;
    // 竞态守卫:下载期间节点换源(重新生成)或已卸载,旧结果不能落地——
    // 否则节点从此播放旧视频(resolved 已置位,新源永不解析),blob 也永不回收
    if (!mountedRef.current || playerVideoSrcRef.current !== requestedSrc) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (blobUrl) { objUrlRef.current = blobUrl; setSrcToUse(blobUrl); setResolved("blob"); }
    else setResolved("native");
  }, [resolved, playerVideoSrc, mountedRef]);

  // hover 自动播放（优先带声；被自动播放策略拦截则静音重试），离开暂停
  const handleVidEnter = useCallback(() => {
    setHovering(true);
    if (resolved) { if (videoRef.current) playVideo(videoRef.current); }
    else void ensureResolved();
  }, [resolved, ensureResolved]);
  const handleVidLeave = useCallback(() => {
    setHovering(false);
    videoRef.current?.pause();
  }, []);
  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    setHovering(true);
    if (resolved) playVideo(v); else void ensureResolved();
  }, [resolved, ensureResolved]);
  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (v) v.currentTime = Number(e.target.value);
  }, []);

  // 截取 当前/首/尾 帧 → 上传 → 在右侧生成一个独立图片节点（不与视频连线）
  const captureAt = useCallback(async (kind: "current" | "first" | "last") => {
    const v = videoRef.current;
    if (!v || capturing || !node.videoSrc) return;
    const dur = v.duration || duration || 0;
    const time = kind === "first" ? 0 : kind === "last" ? Math.max(0, dur - 0.05) : v.currentTime;
    setCapturing(true);
    try {
      // 优先用已缓存的本地 blob 抓帧（同源不污染、省一次下载）；否则用原始 URL（需 GET 跨域）
      const blob = await grabFrame(objUrlRef.current || node.videoSrc, time);
      if (!blob) { toast.error("截图失败：请为媒体源开启 GET 跨域(CORS)"); return; }
      const label = kind === "first" ? "视频首帧" : kind === "last" ? "视频尾帧" : "视频截图";
      const file = new File([blob], `frame_${time.toFixed(1)}s.png`, { type: "image/png" });
      const res = await uploadFileSmart(file, undefined, { maxBytes: resolveModelReferenceLimitBytes(selectedModel, "image"), label: "参考图" });
      if (!res.success || !res.data) { toast.error(res.message || "截图上传失败"); return; }
      const st = useCanvasStore.getState();
      const nid = generateNodeId();
      const cw = node.contentW ?? node.width;
      const vw = v.videoWidth || cw;
      const vh = v.videoHeight || Math.round(cw * 9 / 16);
      const ch = Math.round((cw * vh) / vw);
      // 排到目标列里已有节点（含之前的截图）下方，避免多次截图堆叠重叠
      const { x: targetX, y: targetY } = findRightColumnSpot(st.nodes, node, cw, cw);
      st.addNode({
        id: nid,
        type: "image",
        x: targetX,
        y: targetY,
        width: node.width,
        height: ch,
        contentW: cw,
        contentH: ch,
        title: label,
        imageSrc: res.data.fileUrl,
        status: "success",
        fileSize: res.data.fileSize,
        fileType: res.data.fileType,
        mimeType: res.data.mimeType,
      }, true);
      // 不连线：截图图片为独立节点
      st.selectNode(nid);
      toast.success(`已截取${kind === "first" ? "首帧" : kind === "last" ? "尾帧" : "当前帧"}`);
    } catch {
      // 抓帧/上传异常:给出反馈,避免未处理 rejection 与静默失败。
      toast.error("截图失败，请重试");
    } finally {
      setCapturing(false);
    }
  }, [capturing, duration, node, selectedModel]);

  const copyPrompt = useCallback(async () => {
    const text = node.prompt?.trim();
    if (!text) {
      toast.error("没有可复制的提示词");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制提示词");
    } catch {
      toast.error("复制失败");
    }
  }, [node.prompt]);

  const handleClipReshoot = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!node.videoSrc || nodeUploading || generating) return;

    const referenceModel = selectClipReshootModel(videoModels, selectedModelId);
    if (!referenceModel) {
      toast.error("当前没有支持视频参考的模型，暂时无法片段重拍");
      return;
    }

    const state = useCanvasStore.getState();
    const newId = generateNodeId();
    const { x, y } = findRightColumnSpot(state.nodes, node, cardW, cardW);
    state.addNodesAndConnections(
      [buildClipReshootNode({
        source: node,
        id: newId,
        x,
        y,
        modelId: referenceModel.modelId,
        ratio: videoParam.ratio,
        resolution: videoParam.resolution,
        duration: videoParam.duration,
      })],
      [{
        id: `conn_${node.id}_${newId}`,
        sourceId: node.id,
        targetId: newId,
      }],
      newId,
    );
    toast.info("已创建片段重拍节点，请在时间轴选择片段并描述要修改的画面");
  }, [cardW, generating, node, nodeUploading, selectedModelId, videoModels, videoParam.duration, videoParam.ratio, videoParam.resolution]);

  const handleFrameBreakdown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!node.videoSrc || nodeUploading || generating) return;
    const state = useCanvasStore.getState();
    const newId = generateNodeId();
    const { x, y } = findRightColumnSpot(state.nodes, node, cardW, BREAKDOWN_NODE_WIDTH);
    state.addNodesAndConnections(
      [{
        id: newId,
        type: "video_breakdown",
        x,
        y,
        width: BREAKDOWN_NODE_WIDTH,
        height: BREAKDOWN_NODE_HEIGHT,
        contentW: BREAKDOWN_NODE_WIDTH,
        contentH: BREAKDOWN_NODE_HEIGHT,
        title: "逐帧拉片",
        videoBreakdown: {
          frameCount: 12,
          framesPerGroup: 4,
          runCount: 0,
          analysisModes: ["storyboard", "motion"],
        },
        status: "idle",
      }],
      [{ id: `conn_${node.id}_${newId}`, sourceId: node.id, targetId: newId }],
      newId,
    );
    toast.info("已创建逐帧拉片节点，可选择密度后开始拉片");
  }, [cardW, generating, node, nodeUploading]);

  const handleGenerate = () => {
    if (!clipReshootModelReady) {
      toast.error("当前没有支持视频参考的模型，暂时无法片段重拍");
      return;
    }
    if (!clipReshootSourceReady) {
      toast.error("片段重拍的来源视频已断开，请重新连接原视频");
      return;
    }
    const st = useCanvasStore.getState();
    const incoming = st.connections.filter((c) => c.targetId === node.id);
    const sources = getIncomingSources(st, node.id);
    const effectiveVideoTab = isClipReshoot ? "全能参考" : videoTab;
    const limit = TAB_LIMITS[effectiveVideoTab];
    const imageSources = sources.filter((n) => isImageReferenceNodeType(n.type) && n.imageSrc);
    const videoSources = sources.filter((n) => n.type === "video" && n.videoSrc);
    const audioSources = sources.filter((n) => n.type === "audio" && n.audioSrc);
    const isOmniMode = effectiveVideoTab === "图片参考" || effectiveVideoTab === "全能参考";
    if (effectiveVideoTab === "图片参考" && !omniImageSupported) {
      toast.error("所选模型不支持参考图片，请切换生成方式或更换模型");
      return;
    }
    if (effectiveVideoTab === "全能参考" && !omniImageSupported && !omniVideoSupported && !omniAudioSupported) {
      toast.error("所选模型在画布节点中没有可用的全能参考素材类型");
      return;
    }
    const activeImageSources = isOmniMode && !omniImageSupported ? [] : imageSources;
    const activeVideoSources = effectiveVideoTab === "全能参考" && omniVideoSupported ? videoSources : [];
    const activeAudioSources = effectiveVideoTab === "全能参考" && omniAudioSupported ? audioSources : [];
    const activeReferenceSources = effectiveVideoTab === "全能参考"
      ? [...activeImageSources, ...activeVideoSources, ...activeAudioSources]
      : effectiveVideoTab === "图片参考" || effectiveVideoTab === "图生视频" || effectiveVideoTab === "首尾帧"
        ? activeImageSources
        : [];
    if (!validateReferenceFileSizes(activeReferenceSources, selectedModel, TAB_HANDLER[effectiveVideoTab])) return;
    // 只收集当前模式真正会下发的素材；全能参考能力开关不影响图生视频/首尾帧。
    const imageUrls = activeImageSources.map((n) => n.imageSrc as string);
    const videoUrls = activeVideoSources.map((n) => n.videoSrc as string);
    const audioUrls = activeAudioSources.map((n) => n.audioSrc as string);
    const sourceVideo = isClipReshoot
      ? node.clipReshootSourceId
        ? sources.find((source) => source.id === node.clipReshootSourceId && source.type === "video" && source.videoSrc)
        : sources.find((source) => source.type === "video" && source.videoSrc)
      : undefined;
    // 文本节点没有独立下发通道，正文只能落进 prompt——顺序与 refs 的「文本N」编号同源。
    // 先内联文本引用再做时间码处理,连进来的文本节点里写的时间码同样被覆盖。
    let userPrompt = inlineIncomingTextRefs(node.prompt || "", sources);
    if (isClipReshoot && !nativeClipReshoot) {
      // ffmpeg 裁拼路径:模型看到的是裁剪后的短片,用户按原片时间轴写的时间码
      // 必须重映射到裁剪时间轴;落在未选中区间的时间码直接拦下。
      const remap = remapClipReshootPromptTimecodes(userPrompt, clipRanges, clipSourceDuration);
      if (remap.error != null) {
        toast.error(remap.error);
        return;
      }
      userPrompt = remap.prompt ?? userPrompt;
    }
    const finalPrompt = isClipReshoot
      ? nativeClipReshoot
        ? `${buildNativeClipReshootInstruction(clipRanges, clipSourceDuration, `视频${clipSourceRefIndex}`)}${userPrompt.trim() ? `\n修改要求：${userPrompt}` : ""}`
        : `${buildClipReshootRangeInstruction(clipRanges, clipSourceDuration, `视频${clipSourceRefIndex}`, providerGenerationDuration)}\n${userPrompt}`.trim()
      : userPrompt;
    if (isClipReshoot) {
      // 校验参照系与下发内容一致:原生路径 = 原片时间轴;裁拼路径 = 重映射后的
      // 裁剪时间轴(总长 = 选区之和)。
      const clipSelectedSeconds = clipRanges.reduce((total, range) => total + range.end - range.start, 0);
      // mediaDuration 与顶部时长链同口径过"正数"闸:存到 0 时裸 ?? 不会落穿,
      // 会把 0 当时长传给校验——判别与越界检查双双短路失效。
      const rangeError = validateClipReshootPrompt(
        finalPrompt,
        nativeClipReshoot ? (positiveSecondsOf(sourceVideo?.mediaDuration) ?? clipSourceDuration) : clipSelectedSeconds,
      );
      if (rangeError) {
        toast.error(rangeError);
        return;
      }
      if (!sourceVideo) {
        toast.error("片段重拍需要连接一个已有视频");
        return;
      }
    }
    // 校验基于实际可用素材数（排除连了但还没生成的空节点）
    const total = imageUrls.length + videoUrls.length + audioUrls.length;
    if (limit && (total < limit.min || total > limit.max)) {
      toast.error(limit.hint);
      return;
    }
    // 数量上限以后台模型配置为准（服务端 validateReferenceCountInput 同源兜底）
    const overflow = refCountOverflow(effectiveVideoTab, {
      image: imageUrls.length,
      video: videoUrls.length,
      audio: audioUrls.length,
    });
    if (overflow) {
      toast.error(
        `${selectedModel?.name ?? "所选模型"}最多支持 ${overflow.limit} 个${overflow.label}，当前为 ${overflow.count} 个`,
      );
      return;
    }

    // 按模式选 handler，把图片/视频/文字喂给生成；模型无某维度(后台全不勾)时该参数不下发
    const base: Record<string, unknown> = {
      prompt: finalPrompt,
      ...(!formatConfig.ratios || formatConfig.ratios.length ? { aspectRatio: videoParam.ratio } : {}),
      ...(!formatConfig.resolutions || formatConfig.resolutions.length ? { resolution: videoParam.resolution } : {}),
      ...(!formatConfig.durations || formatConfig.durations.length || isClipReshoot ? { duration: providerGenerationDuration } : {}),
      ...(formatConfig.audio !== false ? { audio: videoParam.audio } : {}),
    };
    let handler = "text_to_video";
    let input: Record<string, unknown> = base;
    if (effectiveVideoTab === "图生视频") {
      // 图作首帧
      handler = "image_to_video";
      input = { ...base, sourceImage: imageUrls[0] };
    } else if (effectiveVideoTab === "首尾帧") {
      handler = "start_end_to_video";
      input = { ...base, firstFrame: imageUrls[0], lastFrame: imageUrls[1] ?? imageUrls[0] };
    } else if (effectiveVideoTab === "图片参考") {
      // 图作纯参考（无首帧）
      handler = "reference_to_video";
      input = { ...base, references: imageUrls };
    } else if (effectiveVideoTab === "全能参考") {
      // 图片 + 视频 + 文字多模态参考综合（图→reference_image、视频→reference_video）
      handler = "reference_to_video";
      input = {
        ...base,
        ...(imageUrls.length ? { references: imageUrls } : {}),
        ...(videoUrls.length ? { videoReferences: videoUrls } : {}),
        ...(audioUrls.length ? { audioReferences: audioUrls } : {}),
        // 原生时间戳编辑不携带 clipReshoot——服务端不裁不拼,全片作为普通视频参考
        // 直发,计费走常规参考视频口径(与报价 useReferenceVideoQuote 同源一致)。
        ...(isClipReshoot && !nativeClipReshoot && sourceVideo?.videoSrc
          ? { clipReshoot: { sourceUrl: sourceVideo.videoSrc, ranges: clipRanges } satisfies ClipReshootRequest }
          : {}),
      };
    }

    // 非破坏性「重新发送」：本节点已出过结果或失败过 → 克隆一模一样的新节点（同提示词、同入边参考、同画幅），
    // 在新节点生成新视频，原节点结果原样保留；首次生成则原地进行。
    let targetNodeId = node.id;
    const isRegen = !!node.videoSrc || node.status === "error";
    if (isRegen) {
      const newId = generateNodeId();
      st.addNode({
        id: newId,
        type: "video",
        x: node.x,
        y: node.y + (node.contentH ?? node.height) + 80,
        width: node.width,
        height: node.height,
        contentW: node.contentW,
        contentH: node.contentH,
        title: node.title || "视频节点",
        prompt: node.prompt,
        aspectRatio: node.aspectRatio,
        generationConfig: {
          ...node.generationConfig,
          modelId: selectedModelId || node.generationConfig?.modelId,
          resolution: videoParam.resolution,
          duration: generationDuration,
        },
        videoOperation: node.videoOperation,
        clipReshootSourceId: node.clipReshootSourceId,
        clipReshootRanges: node.clipReshootRanges,
        status: "idle",
      }, true);
      // 克隆入边连线，使新节点拥有与原节点完全相同的参考输入
      for (const c of incoming) {
        st.addConnection({ id: `conn_${c.sourceId}_${newId}`, sourceId: c.sourceId, targetId: newId }, false);
      }
      st.selectNode(newId);
      targetNodeId = newId;
      if (node.status === "error") {
        updateNode(node.id, { status: node.videoSrc ? "success" : "idle" });
      }
    }

    generate({ nodeId: targetNodeId, handler, modelId: selectedModelId || "default", input });
  };

  const topToolbarActions: ConfigurableNodeToolbarAction[] = [
    {
      key: "video.clipReshoot",
      group: "creative",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={handleClipReshoot}
          disabled={!node.videoSrc || nodeUploading || generating}
          title={!node.videoSrc || nodeUploading ? "视频就绪后可片段重拍" : generating ? "生成完成后可片段重拍" : "基于当前视频重拍指定时间段"}
          className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors duration-150 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
        >
          <Clapperboard className="h-4 w-4" aria-hidden />
          <span>片段重拍</span>
        </button>
      ),
    },
    {
      key: "video.frameBreakdown",
      group: "creative",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={handleFrameBreakdown}
          disabled={!node.videoSrc || nodeUploading || generating}
          title={!node.videoSrc || nodeUploading ? "视频就绪后可逐帧拉片" : generating ? "生成完成后可逐帧拉片" : "提取代表帧并按分镜分组"}
          className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors duration-150 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          <span>逐帧拉片</span>
        </button>
      ),
    },
    {
      key: "media.replace",
      group: "media",
      overflowLabel: "替换视频",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={openFilePicker}
          disabled={nodeUploading || generating}
          title={generating ? "生成完成后可替换素材" : "重新上传"}
          aria-label={generating ? "生成完成后可替换素材" : "替换视频"}
          className="rounded-xl p-2 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
        >
          <Upload className="h-4 w-4" />
        </button>
      ),
    },
    {
      key: "media.download",
      group: "media",
      overflowLabel: "下载视频",
      content: (
        <button type="button" onMouseDown={stop} onClick={(e) => handleDownload(e, node.videoSrc, node.title || "video", "mp4")} disabled={downloading} title="下载" aria-label="下载视频" className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      ),
    },
    {
      key: "media.preview",
      group: "media",
      overflowLabel: "查看视频",
      content: (
        <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); setPreviewOpen(true); }} title="查看视频" aria-label="查看视频" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Maximize2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      <div className="relative mx-auto" style={{ width: cardW }}>
        <div
          className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70" :
            isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600" : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ width: cardW, height: cardHeight }}
        >
          {generating && <NodeGeneratingOverlay label="AI 视频生成中..." />}
          {nodeUploading && <NodeUploadingOverlay pct={nodeUploadPct} previewSrc={uploadPreviewSrc} kind="video" />}
          {node.status === "error" && !generating && !node.videoSrc && <NodeErrorBadge />}

          {playerVideoSrc ? (
            <div className="relative h-full w-full cursor-grab" onMouseEnter={handleVidEnter} onMouseLeave={handleVidLeave}>
              <video
                ref={videoRef}
                // 空串会触发浏览器重新下载整页（React 警告）；未就绪时传 undefined 不渲染 src 属性
                src={srcToUse || undefined}
                preload="metadata"
                playsInline
                // 禁用浏览器/扩展注入的视频悬浮按钮（画中画浮标、下载/翻译工具条）
                disablePictureInPicture
                controlsList="nodownload noremoteplayback"
                className="h-full w-full bg-black object-contain"
                onLoadedMetadata={(e) => {
                  const width = e.currentTarget.videoWidth;
                  const height = e.currentTarget.videoHeight;
                  const nextDuration = e.currentTarget.duration || 0;
                  setVideoDims({ w: width, h: height });
                  setDuration(nextDuration);
                  const metadataNode = isClipReshoot && !node.videoSrc && clipSourceVideo
                    ? clipSourceVideo
                    : node;
                  if (playerVideoSrc && (
                    Math.abs((metadataNode.mediaDuration ?? 0) - nextDuration) > 0.01
                    || metadataNode.mediaWidth !== width
                    || metadataNode.mediaHeight !== height
                  )) {
                    updateNode(metadataNode.id, {
                      mediaDuration: nextDuration,
                      mediaWidth: width,
                      mediaHeight: height,
                    }, false);
                  }
                }}
                onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              {/* 自定义控制条 */}
              <div className="absolute inset-x-3 bottom-3 flex h-8 select-none items-center gap-2 rounded-full bg-black/55 px-2.5 text-white shadow-lg backdrop-blur-sm">
                <button onMouseDown={stop} onClick={togglePlay} title={playing ? "暂停" : "播放"}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/15">
                  {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
                </button>
                <span className="shrink-0 text-xs tabular-nums text-white">{fmtSec(currentTime)}</span>
                <input
                  type="range" min={0} max={duration || 0} step={0.05} value={currentTime}
                  onMouseDown={stop} onChange={seek}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
                />
                <span className="shrink-0 text-xs tabular-nums text-white">{fmtSec(duration)}</span>
                {/* 截图：hover 暂停视频 + 弹出 当前/首/尾 帧选项 */}
                <div
                  className="group/cap relative shrink-0"
                  onMouseEnter={() => videoRef.current?.pause()}
                  onMouseLeave={() => { if (hovering && videoRef.current) playVideo(videoRef.current); }}
                >
                  <div className="absolute bottom-full right-0 hidden min-w-[120px] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900/95 py-1 text-xs text-white shadow-xl group-hover/cap:flex">
                    <button onMouseDown={stop} onClick={() => captureAt("current")} className="cursor-pointer px-3 py-1.5 text-left hover:bg-white/10">截取当前帧</button>
                    <button onMouseDown={stop} onClick={() => captureAt("first")} className="cursor-pointer px-3 py-1.5 text-left hover:bg-white/10">截取首帧</button>
                    <button onMouseDown={stop} onClick={() => captureAt("last")} className="cursor-pointer px-3 py-1.5 text-left hover:bg-white/10">截取尾帧</button>
                  </div>
                  <button onMouseDown={stop} onClick={() => captureAt("current")} disabled={capturing} title="截取当前视频画面（悬停可选首/尾帧）"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-white transition-colors hover:bg-white/20 disabled:opacity-50">
                    {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-1 items-center justify-center p-6">
                {(() => {
                  const r = parseRatio(videoParam.ratio);
                  const MAX_W = 280, MAX_H = 220;
                  let w = MAX_W, h = MAX_H;
                  if (r) {
                    const aspect = r.w / r.h;
                    if (aspect >= MAX_W / MAX_H) { w = MAX_W; h = MAX_W / aspect; }
                    else { h = MAX_H; w = MAX_H * aspect; }
                  }
                  return (
                    <div className="flex items-center justify-center" style={{ width: w, height: h }}>
                      <Play className="h-12 w-12 text-neutral-300 dark:text-neutral-600" fill="currentColor" />
                    </div>
                  );
                })()}
              </div>
              <div className="px-6 pb-5">
                <p className="mb-2 text-sm text-neutral-500">尝试：</p>
                <div className="flex flex-col items-start gap-1">
                  <button onMouseDown={stop} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                      <Layers className="h-3.5 w-3.5" />
                    </span>
                    首尾帧生成视频
                  </button>
                  <button onMouseDown={stop} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    首帧生成视频
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {clipTimelineVisible && clipSourceVideo?.videoSrc && (
          <div style={{ width: promptPanelW, marginLeft: (cardW - promptPanelW) / 2 }}>
            <VideoClipReshootTimeline
              src={clipSourceVideo.videoSrc}
              duration={clipSourceDuration}
              ranges={clipRanges}
              currentTime={currentTime}
              onChange={(nextRanges) => updateNode(node.id, {
                clipReshootRanges: nextRanges,
                generationConfig: {
                  ...node.generationConfig,
                  duration: clipReshootProviderDuration(nextRanges, clipSourceDuration),
                },
              })}
              onSeek={(time) => {
                if (videoRef.current) videoRef.current.currentTime = time;
                setCurrentTime(time);
              }}
              onThumbnailReady={handleClipSourceThumbnail}
            />
          </div>
        )}

        {/* 外置组件：恒定大小·跟随节点（按 1/zoom 反向缩放，吸附卡片边缘） */}
        <NodeHeader icon={Video} title={node.title || "视频节点"} visible={showAuxUI} overlay />
        {/* 尺寸标签只在确有视频(上传成功/已生成)时显示——探测是异步的，上传失败后
            probe 可能仍晚回填一次 videoDims，用 node.videoSrc 兜底避免残留孤立标签 */}
        {showAuxUI && videoDims && playerVideoSrc && (
          <NodeDimsBadge dims={videoDims} />
        )}
        {showAuxUI && !node.videoSrc && !isClipReshoot && configuredFeatures.includes("media.replace") && (
          <NodeChrome placement="top-center" gap={8} zIndex={20}>
            <div onMouseDown={stop} className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <button onMouseDown={stop} onClick={openFilePicker} disabled={nodeUploading || generating}
                title={generating ? "生成完成后可上传素材" : "上传视频"}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
                {nodeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 上传
              </button>
            </div>
          </NodeChrome>
        )}
        {/* 已生成：顶部操作工具栏（恒定大小胶囊，与图片节点一致风格） */}
        {showAuxUI && node.videoSrc && configuredFeatures.length > 0 && (
          <NodeChrome placement="top-center" gap={10}>
            <ConfigurableNodeToolbar
              featureKeys={configuredFeatures}
              actions={topToolbarActions}
              onMouseDown={stop}
              ariaLabel={`${node.title || "视频节点"}顶部功能`}
            />
          </NodeChrome>
        )}
        <NodePorts nodeId={node.id} visible={showAuxUI} overlay onPortMouseDown={onPortMouseDown} />
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />

        {showAuxUI && (
          <NodePanelChrome width={promptPanelW} height={250}>
              {/* 富文本输入（@ 引用「图片N」内联绑定参考图，与图片节点统一）。
                  模式选择收进底栏下拉(对齐参考产品),不再占顶部一行 Tab */}
              <PromptRefEditor
                fill
                refs={refs}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                onSubmit={() => { if (hasPromptSource && clipReshootModelReady && clipReshootSourceReady && !generating && !nodeUploading && !referenceVideoQuote.loading) handleGenerate(); }}
                editorContext={isClipReshoot && clipSourceVideo ? (
                  <div className="flex min-h-7 flex-wrap items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
                    <span>把</span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {clipSourceThumbnail && clipSourceThumbnail.src === clipSourceVideo.videoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={clipSourceThumbnail.thumbnail} alt="" className="h-4 w-4 rounded-sm object-cover" />
                      ) : (
                        <Video className="h-3.5 w-3.5" />
                      )}
                      视频{clipSourceRefIndex}
                    </span>
                    <span>中</span>
                    {clipRanges.map((range, index) => (
                      <span
                        key={`${range.start}-${range.end}-${index}`}
                        className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-1 text-xs tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                      >
                        <Video className="h-3.5 w-3.5" />
                        {formatClipReshootTime(range.start)}–{formatClipReshootTime(range.end)}
                      </span>
                    ))}
                    {/* 裁拼路径多选区 = 一次生成再算术切分,每个接缝都可能截断动作;
                        原生时间戳编辑无此弱点,不提示。 */}
                    {clipRanges.length > 1 && !nativeClipReshoot && (
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">· 单个选区的重拍效果最佳</span>
                    )}
                    {/* 原生管线可见化:时长档与积分随之按完整原片计,给用户一个解释锚点。 */}
                    {nativeClipReshoot && (
                      <span
                        className="text-xs text-neutral-400 dark:text-neutral-500"
                        title="当前模型支持原生时间戳编辑：完整视频直发模型按时间码局部重生成，接缝一致性由模型保证；时长与积分按完整输出计"
                      >
                        · 原生时间戳编辑
                      </span>
                    )}
                  </div>
                ) : undefined}
                placeholder={isClipReshoot
                  ? "描述选中片段里需要改变的画面，例如：把瞳孔改成红色，并逐渐变为蓝色"
                  : "描述你想要生成的画面内容，@ 引用已连接素材（图片1/文本1…）"}
              />
              <PromptEditorModal
                open={promptExpanded}
                onClose={() => setPromptExpanded(false)}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                refs={refs}
                placeholder={isClipReshoot
                  ? "描述选中片段里需要改变的画面，例如：把瞳孔改成红色，并逐渐变为蓝色"
                  : "描述你想要生成的画面内容，@ 引用已连接素材（图片1/文本1…）"}
              />
              {/* 底部栏(对齐参考产品):左 = 模型 · 模式 · 参数摘要;右 = 复制/展开 · 积分 · 发送 */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-nowrap items-center gap-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={selectableVideoModels} value={selectedModelId} onChange={setSelectedModelId} />
                  {/* 片段重拍的模式是节点固有属性(强制全能参考,538 行 effect 吸回),
                      展示一个"点了会弹回"的下拉是撒谎 UI——直接隐藏。 */}
                  {!isClipReshoot && (
                    <VideoModeDropdown
                      tabs={visibleTabs}
                      value={videoTab}
                      onChange={setVideoTab}
                      enabledOf={tabEnabled}
                      hintOf={tabHint}
                    />
                  )}
                  <VideoParamPicker
                    value={isClipReshoot ? { ...videoParam, duration: generationDuration } : videoParam}
                    onChange={setVideoParam}
                    resolutions={formatConfig.resolutions}
                    ratios={formatConfig.ratios}
                    durations={isClipReshoot ? [generationDuration] : formatConfig.durations}
                    allowAudio={formatConfig.audio}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); void copyPrompt(); }}
                    title="复制提示词"
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); setPromptExpanded(true); }}
                    title="展开编辑"
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <span
                    className="flex items-center gap-0.5 px-0.5"
                    title={referenceVideoQuote.quote.pointCost > 0
                      ? `含参考视频 ${referenceVideoQuote.quote.videoCount} 个，共 ${referenceVideoQuote.quote.durationSeconds.toFixed(1)} 秒，额外 ${referenceVideoQuote.quote.pointCost} 积分`
                      : undefined}
                  >
                    <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                    {referenceVideoQuote.loading ? "…" : referenceVideoQuote.failed ? "待核验" : Math.ceil(pointCost)}
                  </span>
                  <GenerateSubmitButton
                    disabled={!hasPromptSource || !clipReshootModelReady || !clipReshootSourceReady || generating || nodeUploading || referenceVideoQuote.loading}
                    generating={generating}
                    title={generating ? "生成中..." : nodeUploading ? "素材上传中..." : referenceVideoQuote.loading ? "正在核验参考视频时长..." : !clipReshootModelReady ? "没有支持视频参考的模型" : !clipReshootSourceReady ? "片段重拍的来源视频已断开" : !hasPromptSource ? "先输入提示词" : "开始生成"}
                    onClick={() => { if (hasPromptSource && clipReshootModelReady && clipReshootSourceReady && !generating && !nodeUploading && !referenceVideoQuote.loading) handleGenerate(); }}
                  />
                </div>
              </div>
          </NodePanelChrome>
        )}

        {/* 查看大图：全屏 lightbox（Portal 到 body，脱离画布缩放层） */}
        {previewOpen && playerVideoSrc && (
          <NodeMediaLightbox onClose={() => setPreviewOpen(false)}>
            <div className="relative">
              <CapturableVideo
                src={playerVideoSrc}
                controls
                autoPlay
                disablePictureInPicture
                controlsList="nodownload noremoteplayback"
                className="max-h-[92vh] max-w-[92vw] rounded-xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </NodeMediaLightbox>
        )}
      </div>
    </NodeShell>
  );
});
