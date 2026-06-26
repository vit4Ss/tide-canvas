"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import { Video, Upload, MapPin, Camera, Loader2, Languages, Play, Pause, Download, Maximize2, X, Shield, Zap, ArrowUp, Layers, Sparkles, Copy } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { parseRatio } from "./quality-ratio-picker";
import { VideoParamPicker, type VideoParamValue } from "./video-param-picker";
import { ModelPicker } from "./model-picker";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { applyTeamFactor } from "@/lib/points";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodeChrome } from "./base/node-chrome";
import { PromptRefEditor, PromptEditorModal } from "./prompt-ref-editor";
import { type RefItem } from "./prompt-ref-utils";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

// 各模式（Tab）对连接源节点的数量/类型限制：hover 时提示，生成时校验。文生视频无需连接。
const TAB_LIMITS: Record<string, { hint: string; min: number; max: number; types: string[] }> = {
  "全能参考": { hint: "需要连接图片/视频节点（1~15 个）", min: 1, max: 15, types: ["image", "video"] },
  "图生视频": { hint: "需要连接图片节点（1 个）", min: 1, max: 1, types: ["image"] },
  "首尾帧": { hint: "需要连接图片节点（1~2 个）", min: 1, max: 2, types: ["image"] },
  "图片参考": { hint: "需要连接图片节点（1~9 个）", min: 1, max: 9, types: ["image"] },
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

export const VideoNode = memo(function VideoNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { user } = useAuth(); // 团队价：消耗按 inTeam 系数加价显示
  // 当前画布缩放：外置组件按 1/zoom 反向缩放，保持恒定屏幕尺寸
  const zoom = useCanvasStore((s) => s.transform.k);
  const [videoParam, setVideoParam] = useState<VideoParamValue>({ ratio: "16:9", resolution: "720P", duration: 5, audio: true });
  const [videoModels, setVideoModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [videoTab, setVideoTab] = useState("文生视频");
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [hoveredTabX, setHoveredTabX] = useState<number | null>(null);
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 自定义播放器：hover 播放 / 离开暂停 + 进度条 + 截图
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);
  // 本地缓存：首次播放下载一次写入 Cache Storage，之后从本地 blob 播放，省流量
  const [srcToUse, setSrcToUse] = useState<string>(node.videoSrc ?? "");
  const [resolved, setResolved] = useState<null | "blob" | "native">(null);
  const [hovering, setHovering] = useState(false);
  const objUrlRef = useRef<string | null>(null);
  const resolvingRef = useRef(false);
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";

  useEffect(() => {
    if (node.videoSrc && node.status === "error" && !generating) {
      updateNode(node.id, { status: "success" });
    }
  }, [generating, node.id, node.status, node.videoSrc, updateNode]);
  const isMultiSelect = useCanvasStore((s) => s.selectedNodeIds.size > 1);
  const showAuxUI = isSelected && !isDragging && !isMultiSelect;

  // ===== 引用（@ 提及）系统：入边图片源节点 → 可内联引用的「图片N」 =====
  const refsSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => {
        const src = s.nodes.find((n) => n.id === c.sourceId);
        return src && src.type === "image" && src.imageSrc ? src.id + "~" + src.imageSrc + "~" + (src.title || "") : "";
      })
      .filter(Boolean)
      .join("|")
  );
  const refs = useMemo<RefItem[]>(() => {
    const st = useCanvasStore.getState();
    const out: RefItem[] = [];
    // 仅入边「图片」源节点参与编号，顺序与 handleGenerate 收集的 imageUrls 一致 → 「图片N」严格对齐第 N 张参考图
    for (const c of st.connections) {
      if (c.targetId !== node.id) continue;
      const src = st.nodes.find((n) => n.id === c.sourceId);
      if (!src || src.type !== "image" || !src.imageSrc) continue;
      out.push({ id: src.id, thumb: src.imageSrc, title: src.title || "", index: out.length + 1 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsSig, node.id]);
  // 实时统计连接到本节点的「有素材」源节点数（图片/视频），用于按模式启用/禁用 Tab
  const connSig = useCanvasStore((s) => {
    let img = 0;
    let vid = 0;
    for (const c of s.connections) {
      if (c.targetId !== node.id) continue;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      if (src?.type === "image" && src.imageSrc) img++;
      else if (src?.type === "video" && src.videoSrc) vid++;
    }
    return `${img},${vid}`;
  });
  const [imgCount, vidCount] = connSig.split(",").map(Number);
  // 某模式 Tab 是否可选：连接的合格素材数落在 [min,max]（文生视频无需连接，恒可选）
  const tabEnabled = (t: string) => {
    const lim = TAB_LIMITS[t];
    if (!lim) return true;
    let m = 0;
    if (lim.types.includes("image")) m += imgCount;
    if (lim.types.includes("video")) m += vidCount;
    return m >= lim.min && m <= lim.max;
  };
  // 当前选中视频模型 → 解析 config（限定清晰度/比例/时长/音频）→ 差异化计费
  const selectedModel = videoModels.find((m) => m.modelId === selectedModelId);
  // 模型支持的模式 Tab：后台对模型勾选了 supportedHandlers 时只显示对应模式；未配置 = 全部
  const modelHandlers = selectedModel?.supportedHandlers;
  const visibleTabs = ALL_TABS.filter(
    (t) => !modelHandlers || modelHandlers.length === 0 || modelHandlers.includes(TAB_HANDLER[t])
  );
  const formatConfig: { resolutions?: string[]; ratios?: string[]; durations?: number[]; audio?: boolean; pricing?: Record<string, Record<string, number>> } = (() => {
    if (!selectedModel?.config) return {};
    try {
      return JSON.parse(selectedModel.config);
    } catch {
      return {};
    }
  })();
  const matrixCost = formatConfig.pricing?.[videoParam.resolution]?.[String(videoParam.duration)];
  const pointCost = matrixCost ?? selectedModel?.pointCost ?? 135;

  // 切换模型后当前比例/清晰度/时长不在该模型的可选档位 → 自动校正为其首个档位
  useEffect(() => {
    setVideoParam((p) => {
      let next = p;
      const { ratios, resolutions, durations } = formatConfig;
      if (ratios?.length && !ratios.includes(p.ratio)) next = { ...next, ratio: ratios[0] };
      if (resolutions?.length && !resolutions.includes(p.resolution)) next = { ...next, resolution: resolutions[0] };
      if (durations?.length && !durations.includes(p.duration)) next = { ...next, duration: [...durations].sort((a, b) => a - b)[0] };
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

  // 卡片实际渲染尺寸同步 store（连线锚点、整理布局与图片节点一致对齐）
  useEffect(() => {
    if (node.contentW !== cardW || node.contentH !== cardHeight) {
      updateNode(node.id, { contentW: cardW, contentH: cardHeight });
    }
  }, [cardW, cardHeight, node.contentW, node.contentH, node.id, updateNode]);

  // 换源时重置缓存解析；若本地已缓存则直接用 blob（刷新/重挂也免下载）
  useEffect(() => {
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    setSrcToUse(node.videoSrc ?? "");
    setResolved(null);
    if (!node.videoSrc) return;
    let cancelled = false;
    void matchCachedVideo(node.videoSrc).then((blobUrl) => {
      if (cancelled) { if (blobUrl) URL.revokeObjectURL(blobUrl); return; }
      if (blobUrl) { objUrlRef.current = blobUrl; setSrcToUse(blobUrl); setResolved("blob"); }
    });
    return () => { cancelled = true; };
  }, [node.videoSrc]);

  // 卸载回收 blob URL
  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  // 悬停且源已就绪 → 播放（首次悬停先下载并缓存，仅下载一次）
  useEffect(() => {
    if (hovering && resolved && videoRef.current) playVideo(videoRef.current);
  }, [hovering, resolved, srcToUse]);

  // 当前模式因连接变化而不再满足条件时，回退到「文生视频」
  useEffect(() => {
    const lim = TAB_LIMITS[videoTab];
    if (!lim) return;
    let m = 0;
    if (lim.types.includes("image")) m += imgCount;
    if (lim.types.includes("video")) m += vidCount;
    if (m < lim.min || m > lim.max) {
      setVideoTab("文生视频");
    }
  }, [imgCount, vidCount, videoTab]);

  // 切换模型后当前模式不被该模型支持 → 回退到其第一个可用模式
  useEffect(() => {
    if (!visibleTabs.includes(videoTab)) {
      setVideoTab(visibleTabs[0] ?? "文生视频");
    }
    // visibleTabs 由 selectedModelId 派生，避免数组引用作为依赖反复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, videoTab]);

  // 上升沿自动升级：从「无连接素材」变为「有素材」时，若仍停留在默认的「文生视频」，自动切到
  // 「全能参考」——否则 text_to_video 不会把连上的参考图喂给上游，参考图形同虚设。仅在 0→有 的
  // 跳变时切换，故用户之后手动改回「文生视频」不会被反复纠正。
  const prevHasMaterialRef = useRef(false);
  useEffect(() => {
    const material = imgCount + vidCount;
    const hasMaterial = material > 0;
    if (hasMaterial && !prevHasMaterialRef.current && videoTab === "文生视频" && material <= 15
        && visibleTabs.includes("全能参考")) {
      setVideoTab("全能参考");
    }
    prevHasMaterialRef.current = hasMaterial;
    // visibleTabs 为派生数组(引用每次渲染变化)，上升沿 guard 已防止重复切换，不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgCount, vidCount, videoTab]);

  // 大图预览：Esc 关闭
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setPreviewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  // 加载视频类型模型，默认选第一个（与图片节点一致的加载方式）
  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (active && res.success) {
        const vids = res.data.filter((m) => m.type === AiModelType.VIDEO);
        setVideoModels(vids);
        if (vids.length > 0) setSelectedModelId((prev) => prev || vids[0].modelId);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // 切换模型后，把视频参数收敛到该模型 config 允许的清晰度/比例/时长/音频，避免下发非法值
  useEffect(() => {
    if (!selectedModel) return;
    setVideoParam((prev) => {
      const next = { ...prev };
      if (formatConfig.resolutions?.length && !formatConfig.resolutions.includes(next.resolution)) next.resolution = formatConfig.resolutions[0];
      if (formatConfig.ratios?.length && !formatConfig.ratios.includes(next.ratio)) next.ratio = formatConfig.ratios[0];
      if (formatConfig.durations?.length && !formatConfig.durations.includes(next.duration)) next.duration = [...formatConfig.durations].sort((a, b) => a - b)[0];
      if (formatConfig.audio === false) next.audio = false;
      return next.resolution === prev.resolution && next.ratio === prev.ratio && next.duration === prev.duration && next.audio === prev.audio ? prev : next;
    });
    // 仅在切换模型时收敛；formatConfig 随 selectedModelId 派生，无需进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

  // 下载视频：经后端代理拉取（同源、无跨域），转 blob 触发下载，不导航刷新
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!node.videoSrc || downloading) return;
    setDownloading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const api = `/api/files/download?url=${encodeURIComponent(node.videoSrc)}&name=${encodeURIComponent(node.title || "video")}`;
      const res = await fetch(api, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${node.title || "video"}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("下载失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  }, [node.videoSrc, node.title, downloading]);

  const openFilePicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  // 上传视频文件：带进度（XHR），上传中显示模糊预览 + 百分比；完成后写回 videoSrc
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    setLocalPreview(objUrl);
    // 探测原始分辨率用于头部「W × H」展示
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setVideoDims({ w: probe.videoWidth, h: probe.videoHeight });
    probe.src = objUrl;
    setUploadPct(0);
    setUploading(true);
    try {
      const res = await uploadFileSmart(file, (pct) => setUploadPct(pct));
      if (res.success) {
        updateNode(node.id, { videoSrc: res.data.fileUrl, status: "success" });
        toast.success("视频已上传");
      } else {
        toast.error(res.message || "上传失败");
      }
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      setLocalPreview(null);
      URL.revokeObjectURL(objUrl);
    }
  }, [node.id, updateNode]);

  // 首次需要播放时：查/建本地缓存→用 blob；跨域不可用则回退原生 src。解析完成由 effect 触发播放。
  const ensureResolved = useCallback(async () => {
    if (resolved || resolvingRef.current || !node.videoSrc) return;
    resolvingRef.current = true;
    const blobUrl = await fetchAndCacheVideo(node.videoSrc);
    if (blobUrl) { objUrlRef.current = blobUrl; setSrcToUse(blobUrl); setResolved("blob"); }
    else setResolved("native");
    resolvingRef.current = false;
  }, [resolved, node.videoSrc]);

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
      const res = await uploadFileSmart(file);
      if (!res.success) { toast.error(res.message || "截图上传失败"); return; }
      const st = useCanvasStore.getState();
      const nid = generateNodeId();
      const cw = node.contentW ?? node.width;
      const vw = v.videoWidth || cw;
      const vh = v.videoHeight || Math.round(cw * 9 / 16);
      const ch = Math.round((cw * vh) / vw);
      // 排到目标列里已有节点（含之前的截图）下方，避免多次截图堆叠重叠
      const targetX = node.x + cw + 80;
      const colNodes = st.nodes.filter((n) => {
        const nw = n.contentW ?? n.width;
        return n.x < targetX + cw && n.x + nw > targetX;
      });
      const targetY = colNodes.length
        ? Math.max(...colNodes.map((n) => n.y + (n.contentH ?? n.height ?? 0))) + 24
        : node.y;
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
      }, true);
      // 不连线：截图图片为独立节点
      st.selectNode(nid);
      toast.success(`已截取${kind === "first" ? "首帧" : kind === "last" ? "尾帧" : "当前帧"}`);
    } finally {
      setCapturing(false);
    }
  }, [capturing, duration, node.x, node.y, node.width, node.contentW, node.videoSrc]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

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

  const handleTabMouseEnter = useCallback((tab: string, e: React.MouseEvent<HTMLButtonElement>) => {
    setHoveredTab(tab);
    const row = tabRowRef.current?.getBoundingClientRect();
    const button = e.currentTarget.getBoundingClientRect();
    if (row) {
      setHoveredTabX(button.left - row.left + button.width / 2);
    }
  }, []);

  const handleTabMouseLeave = useCallback(() => {
    setHoveredTab(null);
    setHoveredTabX(null);
  }, []);

  const handlePromptChange = (value: string) => {
    updateNode(node.id, {
      prompt: value,
      ...(node.status === "error" ? { status: node.videoSrc ? "success" : "idle" } : {}),
    });
  };

  const handleGenerate = () => {
    const st = useCanvasStore.getState();
    const incoming = st.connections.filter((c) => c.targetId === node.id);
    const sources = incoming
      .map((c) => st.nodes.find((n) => n.id === c.sourceId))
      .filter((n): n is CanvasNode => !!n);
    const limit = TAB_LIMITS[videoTab];
    // 分别收集「真正有素材」的图片 / 视频参考 URL
    const imageUrls = sources.filter((n) => n.type === "image" && n.imageSrc).map((n) => n.imageSrc as string);
    const videoUrls = sources.filter((n) => n.type === "video" && n.videoSrc).map((n) => n.videoSrc as string);
    // 校验基于实际可用素材数（排除连了但还没生成的空节点）
    const total = imageUrls.length + videoUrls.length;
    if (limit && (total < limit.min || total > limit.max)) {
      toast.error(limit.hint);
      return;
    }

    // 按模式选 handler，把图片/视频/文字喂给生成；模型无某维度(后台全不勾)时该参数不下发
    const base: Record<string, unknown> = {
      prompt: node.prompt,
      ...(!formatConfig.ratios || formatConfig.ratios.length ? { aspectRatio: videoParam.ratio } : {}),
      ...(!formatConfig.resolutions || formatConfig.resolutions.length ? { resolution: videoParam.resolution } : {}),
      ...(!formatConfig.durations || formatConfig.durations.length ? { duration: videoParam.duration } : {}),
      ...(formatConfig.audio !== false ? { audio: videoParam.audio } : {}),
    };
    let handler = "text_to_video";
    let input: Record<string, unknown> = base;
    if (videoTab === "图生视频") {
      // 图作首帧
      handler = "image_to_video";
      input = { ...base, sourceImage: imageUrls[0] };
    } else if (videoTab === "首尾帧") {
      handler = "start_end_to_video";
      input = { ...base, firstFrame: imageUrls[0], lastFrame: imageUrls[1] ?? imageUrls[0] };
    } else if (videoTab === "图片参考") {
      // 图作纯参考（无首帧）
      handler = "reference_to_video";
      input = { ...base, references: imageUrls };
    } else if (videoTab === "全能参考") {
      // 图片 + 视频 + 文字多模态参考综合（图→reference_image、视频→reference_video）
      handler = "reference_to_video";
      input = { ...base, references: imageUrls, videoReferences: videoUrls };
    }

    // 非破坏性「重新发送」：本节点已出过结果或失败过 → 克隆一摸一样的新节点（同提示词、同入边参考、同画幅），
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

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
    >
      <div className="relative mx-auto" style={{ width: cardW }}>
        <div
          className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70" :
            isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600" : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ width: cardW, height: cardHeight }}
        >
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600 dark:text-neutral-400">AI 视频生成中...</p>
              </div>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 z-[6] overflow-hidden">
              {localPreview ? (
                <video src={localPreview} muted className="h-full w-full scale-110 object-cover blur-xl" />
              ) : (
                <div className="h-full w-full bg-neutral-900" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <p className="text-sm text-white/90">上传中 ({uploadPct}%) …</p>
              </div>
            </div>
          )}
          {node.status === "error" && !generating && !node.videoSrc && (
            <div className="absolute right-3 top-3 z-[5] rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              生成失败
            </div>
          )}

          {node.videoSrc ? (
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
                onLoadedMetadata={(e) => { setVideoDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight }); setDuration(e.currentTarget.duration || 0); }}
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

        {/* 外置组件：恒定大小·跟随节点（按 1/zoom 反向缩放，吸附卡片边缘） */}
        <NodeHeader icon={Video} title={node.title || "视频节点"} visible={showAuxUI} zoom={zoom} />
        {showAuxUI && videoDims && (
          <NodeChrome zoom={zoom} placement="top-right" gap={4}>
            <span className="whitespace-nowrap px-1 text-xs text-neutral-400">{videoDims.w} × {videoDims.h}</span>
          </NodeChrome>
        )}
        {showAuxUI && !node.videoSrc && (
          <NodeChrome zoom={zoom} placement="top-center" gap={8}>
            <button onMouseDown={stop} onClick={openFilePicker} disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              <Upload className="h-3.5 w-3.5" /> 上传
            </button>
          </NodeChrome>
        )}
        {/* 已生成：顶部操作工具栏（恒定大小胶囊，与图片节点一致风格） */}
        {showAuxUI && node.videoSrc && (
          <NodeChrome zoom={zoom} placement="top-center" gap={10}>
            <div onMouseDown={stop} className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <button onMouseDown={stop} onClick={openFilePicker} title="重新上传" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Upload className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={handleDownload} disabled={downloading} title="下载" className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); setPreviewOpen(true); }} title="查看大图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Maximize2 className="h-4 w-4" /></button>
            </div>
          </NodeChrome>
        )}
        <NodePorts nodeId={node.id} visible={showAuxUI} zoom={zoom} onPortMouseDown={onPortMouseDown} />
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />

        {showAuxUI && (
          <NodeChrome zoom={zoom} placement="bottom-center" gap={18} damp={0.6}>
            <div onMouseDown={stop} className="flex flex-col rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30" style={{ width: promptPanelW, height: 250, boxSizing: "border-box" }}>
              {/* 模式 Tab */}
              <div ref={tabRowRef} className="relative flex items-center justify-between gap-1">
                {hoveredTab && TAB_LIMITS[hoveredTab] && (
                  <div className="pointer-events-none absolute bottom-full z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300" style={{ left: hoveredTabX ?? 0 }}>
                    {TAB_LIMITS[hoveredTab].hint}
                  </div>
                )}
                <div className="flex items-center gap-0.5 overflow-x-auto text-xs">
                  {visibleTabs.map((t) => {
                    const enabled = tabEnabled(t);
                    return (
                      <button
                        key={t}
                        onMouseDown={stop}
                        onMouseEnter={(e) => handleTabMouseEnter(t, e)}
                        onMouseLeave={handleTabMouseLeave}
                        onClick={(e) => { stop(e); if (enabled) setVideoTab(t); }}
                        aria-disabled={!enabled}
                        className={`whitespace-nowrap rounded-lg px-2 py-1 transition-colors ${
                          !enabled ? "cursor-not-allowed text-neutral-300 dark:text-neutral-700"
                            : videoTab === t ? "cursor-pointer bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                            : "cursor-pointer text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
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
                </div>
              </div>
              {/* 工具：标记 / 运镜 / 角色库 ＋ 富文本输入（@ 引用「图片N」内联绑定参考图，与图片节点统一） */}
              <PromptRefEditor
                fill
                refs={refs}
                zoom={zoom}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                onSubmit={() => { if (node.prompt?.trim() && !generating) handleGenerate(); }}
                placeholder="描述你想要生成的画面内容，@ 引用已连接图片（图片1/图片2…）"
              />
              <PromptEditorModal
                open={promptExpanded}
                onClose={() => setPromptExpanded(false)}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                refs={refs}
                placeholder="描述你想要生成的画面内容，@ 引用已连接图片（图片1/图片2…）"
              />
              {/* 底部栏 */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex flex-nowrap items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={videoModels} value={selectedModelId} onChange={setSelectedModelId} />
                  <VideoParamPicker
                    value={videoParam}
                    onChange={setVideoParam}
                    resolutions={formatConfig.resolutions}
                    ratios={formatConfig.ratios}
                    durations={formatConfig.durations}
                    allowAudio={formatConfig.audio}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
                  <button onMouseDown={stop} title="翻译" className="rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Languages className="h-3.5 w-3.5" />
                  </button>
                  <span className="flex items-center gap-0.5 px-0.5">
                    <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                    {applyTeamFactor(pointCost, user)}
                    {user?.inTeam && <span className="text-[10px] font-medium text-amber-500">团队价</span>}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); if (node.prompt?.trim() && !generating) handleGenerate(); }}
                    disabled={!node.prompt?.trim() || generating}
                    title={generating ? "生成中..." : "开始生成"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${(!node.prompt?.trim() || generating) ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800" : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"}`}
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </NodeChrome>
        )}

        {/* 查看大图：全屏 lightbox（Portal 到 body，脱离画布缩放层） */}
        {previewOpen && node.videoSrc && createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setPreviewOpen(false)}
          >
            <video
              src={node.videoSrc}
              controls
              autoPlay
              disablePictureInPicture
              controlsList="nodownload noremoteplayback"
              className="max-h-[92vh] max-w-[92vw] rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setPreviewOpen(false)}
              className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
              title="关闭 (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
});
