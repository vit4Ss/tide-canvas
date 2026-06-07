"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import {
  Image as ImageIcon, Upload, Plus, Maximize2, Box, MapPin, Copy,
  Camera, ArrowUp, ChevronDown, ChevronRight, Zap, Download, X,
  ArrowLeft, LayoutGrid, Layers,
  Images, Orbit, Sun, Table, Brush, FlipHorizontal2,
  Focus, Languages, SlidersHorizontal,
} from "lucide-react";
import { QualityRatioPicker, parseRatio, type QualityRatioValue } from "./quality-ratio-picker";
import { ModelPicker } from "./model-picker";
import { PromptRefEditor, PromptEditorModal } from "./prompt-ref-editor";
import { PanoramaViewer } from "./panorama-viewer";
import { type RefItem } from "./prompt-ref-utils";
import { NodeChrome } from "./base/node-chrome";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import { Loader2 } from "lucide-react";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

// 自定义宫格选择器的最大行列（N×N 网格）
const CUSTOM_MAX = 8;

// 提示词面板比图片卡片左右各宽出的总量（仅未生成图片时显示），居中伸出让底部控件更宽松
const PANEL_EXTRA = 80;

// 全景扩图提示词：让模型把当前图扩展为可环绕的 360° 等距柱状全景（2:1）
const PANORAMA_PROMPT =
  "将这张图扩展生成 360° 等距柱状全景图（equirectangular panorama，宽高比 2:1），向四周自然无缝延展场景，保持主体、风格与光照一致，适合球面环绕观看";

// memo 化：仅当自身 props（node / 选中 / 拖拽 / 连接目标）变化时重渲染，
// 画布平移、其他节点拖动都不会触发本节点重渲染。
export const ImageNode = memo(function ImageNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  // 当前画布缩放：外置组件按 1/zoom 反向缩放，保持恒定屏幕尺寸
  const zoom = useCanvasStore((s) => s.transform.k);
  // 多选时隐藏单节点辅助 UI（工具栏/端口/输入框等），仅保留选中边框
  const isMultiSelect = useCanvasStore((s) => s.selectedNodeIds.size > 1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridMenuRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [gridMenuOpen, setGridMenuOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  // 宫格切分：选定宫格数后进入预览模式（图片叠网格线 + 顶栏切换为切分操作栏），再执行切分
  const [gridPreview, setGridPreview] = useState<{ rows: number; cols: number } | null>(null);
  // 自定义宫格选择器当前 hover 的行列（r 行 c 列）
  const [customHover, setCustomHover] = useState<{ r: number; c: number } | null>(null);
  // 预览模式下被点选的格子（行优先 0-based 索引）；为空则切分全部
  const [selectedCells, setSelectedCells] = useState<Set<number>>(new Set());
  // 查看大图：应用内 lightbox 模态
  const [previewOpen, setPreviewOpen] = useState(false);
  // 360° 全景查看器（src 为生成出的全景扩图地址）
  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const [panoramaSrc, setPanoramaSrc] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const [imageModels, setImageModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [qualityRatio, setQualityRatio] = useState<QualityRatioValue>({
    quality: "standard",
    clarity: "2K",
    ratio: "16:9",
  });
  // 一次出图张数（批量）：首张写回本节点，其余铺成新节点
  const [batchCount, setBatchCount] = useState(1);
  const [batchOpen, setBatchOpen] = useState(false);
  // 已生成图片的真实宽高比（onLoad 时测量），用于让卡片严丝合缝贴合图片
  const [imgAspectState, setImgAspectState] = useState<{ src: string; aspect: number } | null>(null);
  const imgAspect = imgAspectState && imgAspectState.src === node.imageSrc ? imgAspectState.aspect : null;
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";

  // ===== 引用（@ 提及）系统 =====
  // 取入边连接对应的源节点图片，编号 图片1/图片2…。用字符串签名做选择器，
  // 仅在引用真正变化时重渲染，避免拖动其它节点触发本节点重渲染。
  const refsSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => {
        const src = s.nodes.find((n) => n.id === c.sourceId);
        return src ? src.id + "~" + (src.imageSrc || src.videoSrc || "") + "~" + (src.title || "") : "";
      })
      .filter(Boolean)
      .join("|")
  );
  const refs = useMemo<RefItem[]>(() => {
    const st = useCanvasStore.getState();
    const out: RefItem[] = [];
    // 有自有底图时，本节点图占「图片1」（待编辑主图），入边引用图从「图片2」起编号，
    // 与后端 image_urls = [主图, ...参考图] 的下发顺序严格对齐。
    const base = node.imageSrc ? 1 : 0;
    for (const c of st.connections) {
      if (c.targetId !== node.id) continue;
      const src = st.nodes.find((n) => n.id === c.sourceId);
      if (!src) continue;
      out.push({ id: src.id, thumb: src.imageSrc || src.videoSrc || "", title: src.title || "", index: base + out.length + 1 });
    }
    return out;
    // refsSig 作为相等触发器：仅当引用签名变化时才重建（body 内用 getState 非响应式读取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsSig, node.id, node.imageSrc]);

  // 卡片比例：生成结果优先沿用本次选择的目标画幅，避免返回图自然尺寸把 16:9 卡片改成竖图。
  const requestedRatio = node.aspectRatio || qualityRatio.ratio;
  const ratioParsed = parseRatio(requestedRatio);
  const cardAspect = ratioParsed ? ratioParsed.w / ratioParsed.h : (node.imageSrc && imgAspect ? imgAspect : 4 / 3);
  const CARD_MAX = node.width;
  const cardW = cardAspect >= 1 ? CARD_MAX : Math.round(CARD_MAX * cardAspect);
  const cardH = cardAspect >= 1 ? Math.round(CARD_MAX / cardAspect) : CARD_MAX;
  const selectedModel = imageModels.find((m) => m.modelId === selectedModelId);
  const formatConfig: { qualities?: string[]; clarities?: string[]; ratios?: string[]; pricing?: Record<string, Record<string, number>> } = (() => {
    if (!selectedModel?.config) return {};
    try {
      return JSON.parse(selectedModel.config);
    } catch {
      return {};
    }
  })();
  // 积分消耗：优先按「画质×清晰度」矩阵价，其次模型固定价，其次 Handler 配置，最后兜底 18
  const matrixCost = formatConfig.pricing?.[qualityRatio.quality]?.[qualityRatio.clarity];
  const pointCost = matrixCost ?? selectedModel?.pointCost ?? handlerCosts[node.imageSrc ? "image_to_image" : "text_to_image"] ?? 18;

  // 把卡片实际渲染尺寸同步到 store，供连线层将端点锚定到卡片真实边缘中点（默认对节点居中）。
  // updateNode 默认不记历史；条件守卫确保仅在值变化时写入，自然收敛、不会循环。
  useEffect(() => {
    if (node.contentW !== cardW || node.contentH !== cardH) {
      updateNode(node.id, { contentW: cardW, contentH: cardH });
    }
  }, [cardW, cardH, node.contentW, node.contentH, node.id, updateNode]);

  const handleGenerate = useCallback(() => {
    // 引用图片参与编辑：按画布连接顺序完整下发 imageList，保证 prompt 里的「图片N / {{Image N}}」
    // 对齐到第 N 张输入图；若本节点已有图，则它固定作为 Image 1。
    const refImages = refs.map((r) => r.thumb).filter(Boolean);
    const ownImage = node.imageSrc || "";
    const imageList = ownImage ? [ownImage, ...refImages] : refImages;
    const hasImage = imageList.length > 0;
    generate({
      nodeId: node.id,
      handler: hasImage ? "image_to_image" : "text_to_image",
      modelId: selectedModelId || "default",
      input: {
        prompt: node.prompt,
        ...(imageList.length ? { imageList, sourceImage: imageList[0], references: imageList.slice(1) } : {}),
        aspectRatio: qualityRatio.ratio,
        aspect_ratio: qualityRatio.ratio,
        ratio: qualityRatio.ratio,
        quality: qualityRatio.quality,
        clarity: qualityRatio.clarity,
        resolution: qualityRatio.clarity,
        ...(batchCount > 1 ? { batchCount } : {}),
      },
    });
  }, [generate, node.id, node.prompt, node.imageSrc, qualityRatio, selectedModelId, refs, batchCount]);

  // 全景：先 AI 生成 360° 全景扩图（新建 2:1 图片节点并连线），完成后自动打开 360 查看器
  const generatePanorama = useCallback(() => {
    if (!node.imageSrc) { toast.error("请先生成或上传图片"); return; }
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const cw = node.contentW ?? node.width;
    const ph = Math.round(cw / 2); // 等距柱状全景 2:1
    // 放到右侧列下方，避免与已有节点堆叠
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
      height: ph,
      contentW: cw,
      contentH: ph,
      title: "全景图",
      status: "idle",
      is360: true,
      aspectRatio: "2:1",
    }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
    st.selectNode(nid);
    generate({
      nodeId: nid,
      handler: "image_to_image",
      modelId: selectedModelId || "default",
      input: {
        prompt: PANORAMA_PROMPT,
        imageList: [node.imageSrc],
        sourceImage: node.imageSrc,
        aspectRatio: "2:1",
        aspect_ratio: "2:1",
        ratio: "2:1",
        quality: qualityRatio.quality,
        clarity: qualityRatio.clarity,
        resolution: qualityRatio.clarity,
      },
      onSuccess: (url) => { setPanoramaSrc(url); setPanoramaOpen(true); },
    });
  }, [generate, node.id, node.x, node.y, node.width, node.contentW, node.imageSrc, qualityRatio, selectedModelId]);

  // 宫格切分：调后端把当前图切成 rows×cols 块，每块作为新图片节点铺在原节点右侧
  const handleGridSplit = useCallback(async (rows: number, cols: number, cells: number[] | null = null) => {
    if (!node.imageSrc || splitting) return;
    setGridMenuOpen(false);
    setSplitting(true);
    try {
      const res = await aiApi.gridSplit(node.imageSrc, rows, cols, cells ?? undefined);
      if (res.success && res.data?.length) {
        const urls = res.data;
        // urls 顺序对应所切格子：指定 cells 时即 cells，否则行优先 0..N-1
        const cellList = cells ?? urls.map((_, i) => i);
        const store = useCanvasStore.getState();
        // 每块宽高比 = 原图比例 × rows/cols；据此排成紧凑网格，按原格子位置摆放
        const origAR = (node.contentW ?? node.width) / ((node.contentH ?? node.height) || 1);
        const cellAR = (origAR * rows) / cols;
        // 切片节点与源节点保持一致大小（同宽）
        const CELL_W = node.contentW ?? node.width;
        const CELL_H = Math.max(60, Math.round(CELL_W / (cellAR || 1)));
        const gap = 24;
        const startX = node.x + (node.contentW ?? node.width) + 100;
        urls.forEach((url, i) => {
          const cellIdx = cellList[i];
          const r = Math.floor(cellIdx / cols);
          const c = cellIdx % cols;
          const nid = generateNodeId();
          store.addNode(
            {
              id: nid,
              type: "image",
              x: startX + c * (CELL_W + gap),
              y: node.y + r * (CELL_H + gap),
              width: CELL_W,
              height: CELL_H,
              title: `切片 ${cellIdx + 1}`,
              imageSrc: url,
              status: "idle",
            },
            i === 0, // 仅首块记入历史，整批一次撤销
          );
          // 切片连回原节点，标明来源
          store.addConnection(
            { id: `conn_${nid}_${node.id}`, sourceId: node.id, targetId: nid },
            false,
          );
        });
        toast.success(`已切分为 ${urls.length} 块`);
      } else {
        toast.error(res.message || "切分失败");
      }
    } catch {
      toast.error("切分失败，请稍后重试");
    } finally {
      setSplitting(false);
    }
  }, [node.imageSrc, node.id, node.x, node.y, node.width, node.height, node.contentW, node.contentH, splitting]);

  // 选定宫格数（预设或自定义）→ 进入预览模式，不立即切分
  const enterGridPreview = useCallback((rows: number, cols: number) => {
    setGridMenuOpen(false);
    setCustomHover(null);
    setSelectedCells(new Set());
    setGridPreview({ rows, cols });
  }, []);

  // 预览模式下点选/取消某个格子
  const toggleCell = useCallback((idx: number) => {
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  // 预览模式「创建分镜组」→ 有选中则只切选中、无选中则全部，切完退出预览
  const confirmGridSplit = useCallback(() => {
    if (!gridPreview) return;
    const cells = selectedCells.size > 0 ? [...selectedCells].sort((a, b) => a - b) : null;
    handleGridSplit(gridPreview.rows, gridPreview.cols, cells);
    setGridPreview(null);
    setSelectedCells(new Set());
  }, [gridPreview, selectedCells, handleGridSplit]);

  // 下载图片：经后端代理拉取（同源、无跨域），转 blob 触发浏览器下载，全程不导航刷新
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!node.imageSrc || downloading) return;
    setDownloading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const api = `/api/files/download?url=${encodeURIComponent(node.imageSrc)}&name=${encodeURIComponent(node.title || "image")}`;
      const res = await fetch(api, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${node.title || "image"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("下载失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  }, [node.imageSrc, node.title, downloading]);

  // 大图预览：Esc 关闭
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setPreviewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  // 打开文件选择器
  const openFilePicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  // 上传图片并设为节点图片（带进度；之后输入指令即可做图生图编辑）
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    setLocalPreview(objUrl);
    // 探测原始分辨率用于头部「W × H」展示
    const probe = document.createElement("img");
    probe.onload = () => setImageDims({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.src = objUrl;
    setUploadPct(0);
    setUploading(true);
    try {
      const res = await uploadFileSmart(file, (pct) => setUploadPct(pct));
      if (res.success) {
        updateNode(node.id, { imageSrc: res.data.fileUrl, status: "idle" });
        toast.success("图片已上传，可输入指令进行编辑");
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

  // 拉取各 Handler 的积分消耗（后台可配置）
  useEffect(() => {
    let active = true;
    aiApi.listHandlers().then((res) => {
      if (active && res.success) {
        const map: Record<string, number> = {};
        res.data.forEach((h) => {
          if (h.handlerName) map[h.handlerName] = h.pointCost ?? 0;
        });
        setHandlerCosts(map);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // 拉取可用图片模型（后台配置，含图标与支持的格式）
  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (active && res.success) {
        const imgs = res.data.filter((m) => m.type === AiModelType.IMAGE);
        setImageModels(imgs);
        if (imgs.length > 0) setSelectedModelId((prev) => prev || imgs[0].modelId);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // 仅选中且非拖动状态下显示辅助 UI
  const showAuxUI = isSelected && !isDragging && !isMultiSelect;

  // 失焦/拖拽/多选时关闭顶部下拉，避免重新选中时下拉仍残留
  useEffect(() => {
    if (!showAuxUI) {
      setGridMenuOpen(false);
      setCustomHover(null);
      setBatchOpen(false);
    }
  }, [showAuxUI]);

  // 点击「宫格切分」菜单外部时关闭
  useEffect(() => {
    if (!gridMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (gridMenuRef.current && !gridMenuRef.current.contains(e.target as Node)) {
        setGridMenuOpen(false);
        setCustomHover(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [gridMenuOpen]);

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      {/* 卡片尺寸的定位容器（居中）；外置组件以卡片边缘为锚做恒定大小覆盖层 */}
      <div className="relative mx-auto" style={{ width: cardW }}>
        {/* 标题：恒定大小，吸附卡片左上方 */}
        {showAuxUI && !node.imageSrc && (
          <NodeChrome zoom={zoom} placement="top-left" gap={4}>
            <div className="flex items-center gap-1.5 whitespace-nowrap px-1 text-sm text-neutral-600 dark:text-neutral-300">
              <ImageIcon className="h-4 w-4" />
              <span className="font-medium">{node.title || "图片节点"}</span>
            </div>
          </NodeChrome>
        )}
        {/* 右上角分辨率（上传/生成后展示 W × H） */}
        {showAuxUI && imageDims && (
          <NodeChrome zoom={zoom} placement="top-right" gap={4}>
            <span className="whitespace-nowrap px-1 text-xs text-neutral-400">{imageDims.w} × {imageDims.h}</span>
          </NodeChrome>
        )}
        {/* 未生成：顶部「上传」按钮（恒定大小，吸附卡片正上方） */}
        {showAuxUI && !node.imageSrc && (
          <NodeChrome zoom={zoom} placement="top-center" gap={8}>
            <button
              onMouseDown={stop}
              onClick={openFilePicker}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              上传
            </button>
          </NodeChrome>
        )}
        {/* 已生成 + 非预览：顶部操作工具栏（恒定大小独立胶囊，吸附卡片左上方）。
            zIndex 抬到端口(默认 10)之上，避免「宫格切分」下拉被端口 + 盖住 */}
        {showAuxUI && node.imageSrc && !gridPreview && (
          <NodeChrome zoom={zoom} placement="top-center" gap={10} zIndex={20}>
            <div
              onMouseDown={stop}
              className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {/* 全景（NEW）：普通图先 AI 生成全景扩图再 360 环视；已是全景图则直接环视 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); if (!node.imageSrc) { toast.error("请先生成或上传图片"); } else if (node.is360) { setPanoramaSrc(node.imageSrc); setPanoramaOpen(true); } else { generatePanorama(); } }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Images className="h-4 w-4" />
                全景
                <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">NEW</span>
              </button>
              {/* 多角度 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「多角度」功能即将上线"); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Orbit className="h-4 w-4" /> 多角度
              </button>
              {/* 打光 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「打光」功能即将上线"); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Sun className="h-4 w-4" /> 打光
              </button>
              <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
              {/* 九宫格 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「九宫格」功能即将上线"); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <LayoutGrid className="h-4 w-4" /> 九宫格 <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
              </button>
              {/* 高清 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「高清」功能即将上线"); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <span className="flex h-4 items-center rounded bg-neutral-200 px-1 text-[10px] font-bold leading-none text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">HD</span>
                高清 <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
              </button>
              {/* 宫格切分（下拉：预设 + 自定义网格选择器） */}
              <div className="relative" ref={gridMenuRef}>
                <button onMouseDown={stop} onClick={(e) => { stop(e); setGridMenuOpen((v) => !v); }} disabled={splitting} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
                  {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table className="h-4 w-4" />}
                  宫格切分 <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
                </button>
                {gridMenuOpen && (
                  <div onMouseDown={stop} className="absolute left-0 top-full z-30 mt-1 w-36 rounded-lg border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    {[{ label: "4宫格 (2×2)", n: 2 }, { label: "9宫格 (3×3)", n: 3 }, { label: "16宫格 (4×4)", n: 4 }, { label: "25宫格 (5×5)", n: 5 }].map((o) => (
                      <button
                        key={o.label}
                        onMouseDown={stop}
                        onClick={(e) => { stop(e); enterGridPreview(o.n, o.n); }}
                        className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        {o.label}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                    {/* 自定义：hover 弹出网格选择器，鼠标滑动选 r×c */}
                    <div
                      className="relative"
                      onMouseEnter={() => setCustomHover((h) => h ?? { r: 1, c: 1 })}
                      onMouseLeave={() => setCustomHover(null)}
                    >
                      <button onMouseDown={stop} className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        自定义 <ChevronRight className="h-3 w-3" />
                      </button>
                      {customHover && (
                        <div onMouseDown={stop} className="absolute left-full top-0 ml-1 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                          <div className="mb-2 flex items-center justify-between gap-8">
                            <span className="font-medium text-neutral-700 dark:text-neutral-200">自定义宫格</span>
                            <span className="text-neutral-400">{customHover.c} x {customHover.r}</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            {Array.from({ length: CUSTOM_MAX }, (_, ri) => (
                              <div key={ri} className="flex gap-1">
                                {Array.from({ length: CUSTOM_MAX }, (_, ci) => {
                                  const r = ri + 1;
                                  const c = ci + 1;
                                  const active = r <= customHover.r && c <= customHover.c;
                                  return (
                                    <button
                                      key={ci}
                                      onMouseDown={stop}
                                      onMouseEnter={() => setCustomHover({ r, c })}
                                      onClick={(e) => { stop(e); enterGridPreview(r, c); }}
                                      className={`h-5 w-5 rounded-sm border transition-colors ${active ? "border-blue-400 bg-blue-300 dark:border-blue-400 dark:bg-blue-500" : "border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800"}`}
                                    />
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
              {/* 笔（编辑 / 图生图）· 镜像 · 下载 · 放大 */}
              <button onMouseDown={stop} onClick={openFilePicker} title="重新上传 / 图生图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Brush className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「镜像」功能即将上线"); }} title="镜像" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><FlipHorizontal2 className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={handleDownload} disabled={downloading} title="下载" className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); setPreviewOpen(true); }} title="查看大图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Maximize2 className="h-4 w-4" /></button>
            </div>
          </NodeChrome>
        )}
        {/* 已生成 + 预览模式：切分操作栏（恒定大小独立胶囊） */}
        {showAuxUI && node.imageSrc && gridPreview && (
          <NodeChrome zoom={zoom} placement="top-center" gap={10}>
            <div onMouseDown={stop} className="flex items-center gap-1 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <button onMouseDown={stop} onClick={(e) => { stop(e); setGridPreview(null); setSelectedCells(new Set()); }} title="返回" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
              <LayoutGrid className="h-4 w-4 text-neutral-400" />
              <span className="px-1 text-neutral-500">{gridPreview.cols}×{gridPreview.rows} · {selectedCells.size > 0 ? `已选 ${selectedCells.size} 格` : "点选宫格，或直接全部切分"}</span>
              <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
              <button onMouseDown={stop} onClick={(e) => { stop(e); confirmGridSplit(); }} disabled={splitting} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
                {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
                创建分镜组
              </button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); toast.info("「生成高清图片」功能即将上线"); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Zap className="h-4 w-4" />
                生成高清图片
              </button>
            </div>
          </NodeChrome>
        )}

        {/* 隐藏文件选择器（上传 / 图生图 共用） */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={stop}
          onChange={handleFileChange}
        />

        {/* 360° 全景查看器（展示 AI 生成的全景扩图） */}
        {panoramaOpen && panoramaSrc && (
          <PanoramaViewer src={panoramaSrc} title={node.title} onClose={() => setPanoramaOpen(false)} />
        )}

        {/* 查看大图：全屏 lightbox（Portal 到 body，脱离画布缩放层） */}
        {previewOpen && node.imageSrc && createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setPreviewOpen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={node.imageSrc}
              alt={node.title || ""}
              className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
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

        {/* 主图片区 - 始终显示（作为容器内唯一在流元素，决定容器尺寸） */}
        <div
          className={`relative rounded-2xl border bg-white transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-blue-400 dark:border-blue-400" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ width: cardW, height: cardH }}
        >
          {/* 生成中遮罩 */}
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center rounded-2xl bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600 dark:text-neutral-400">AI 生成中...</p>
              </div>
            </div>
          )}
          {/* 上传中遮罩：模糊预览 + 百分比 */}
          {uploading && (
            <div className="absolute inset-0 z-[6] overflow-hidden rounded-2xl">
              {localPreview ? (
                <img src={localPreview} alt="" className="h-full w-full scale-110 object-cover blur-xl" />
              ) : (
                <div className="h-full w-full bg-neutral-900" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <p className="text-sm text-white/90">上传中 ({uploadPct}%) …</p>
              </div>
            </div>
          )}
          {/* 错误状态 */}
          {node.status === "error" && !generating && (
            <div className="absolute right-3 top-3 z-[5] rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              生成失败
            </div>
          )}
          {/* 宫格切分预览：网格线 + 可点选格子（选中则只切选中，不选则全部） */}
          {gridPreview && node.imageSrc && (
            <div className="absolute inset-0 z-[4] overflow-hidden rounded-2xl">
              <div className="pointer-events-none absolute inset-0">
                {Array.from({ length: gridPreview.cols - 1 }, (_, i) => (
                  <div key={`v${i}`} className="absolute inset-y-0 w-px bg-white/80 shadow-[0_0_2px_rgba(0,0,0,0.45)]" style={{ left: `${((i + 1) / gridPreview.cols) * 100}%` }} />
                ))}
                {Array.from({ length: gridPreview.rows - 1 }, (_, i) => (
                  <div key={`h${i}`} className="absolute inset-x-0 h-px bg-white/80 shadow-[0_0_2px_rgba(0,0,0,0.45)]" style={{ top: `${((i + 1) / gridPreview.rows) * 100}%` }} />
                ))}
              </div>
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${gridPreview.cols}, 1fr)`, gridTemplateRows: `repeat(${gridPreview.rows}, 1fr)` }}>
                {Array.from({ length: gridPreview.rows * gridPreview.cols }, (_, idx) => (
                  <button
                    key={idx}
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); toggleCell(idx); }}
                    className={selectedCells.has(idx) ? "bg-blue-500/40 ring-1 ring-inset ring-blue-300" : "transition-colors hover:bg-white/15"}
                  />
                ))}
              </div>
            </div>
          )}
          {node.imageSrc ? (
            <img
              src={node.imageSrc}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const t = e.currentTarget;
                if (t.naturalWidth > 0 && t.naturalHeight > 0) {
                  setImgAspectState({ src: node.imageSrc || "", aspect: t.naturalWidth / t.naturalHeight });
                  setImageDims({ w: t.naturalWidth, h: t.naturalHeight });
                }
              }}
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-5 p-5">
              <svg className="h-10 w-10 text-neutral-300 dark:text-neutral-700" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="8" r="2" />
                <path d="M2 19l5.5-7L12 17l3.5-4.5L22 19z" />
              </svg>
              <div className="w-full px-1">
                <p className="mb-2 text-sm text-neutral-500">尝试：</p>
                <div className="flex flex-col items-start gap-1">
                  <button
                    onMouseDown={stop}
                    onClick={openFilePicker}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    </span>
                    图生图
                  </button>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); toast.info("图片高清功能即将上线"); }}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold dark:bg-neutral-800">
                      HD
                    </span>
                    图片高清
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* 左右连接端口：恒定大小，吸附卡片左右缘中点 */}
        {showAuxUI && (
          <>
            <NodeChrome zoom={zoom} placement="left" gap={12}>
              <button
                onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, "input", e.clientX, e.clientY); }}
                className="flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-400 shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md active:scale-95 dark:border-neutral-600 dark:bg-neutral-900"
                title="输入端口（从其他节点拖入）"
              >
                <Plus className="h-3 w-3" />
              </button>
            </NodeChrome>
            <NodeChrome zoom={zoom} placement="right" gap={12}>
              <button
                onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, "output", e.clientX, e.clientY); }}
                className="flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-400 shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md active:scale-95 dark:border-neutral-600 dark:bg-neutral-900"
                title="输出端口（拖到其他节点）"
              >
                <Plus className="h-3 w-3" />
              </button>
            </NodeChrome>
          </>
        )}

        {/* 提示词输入面板：恒定大小，吸附卡片正下方居中 */}
        {showAuxUI && !node.imageSrc && (
          <NodeChrome zoom={zoom} placement="bottom-center" gap={12}>
            <div
              className="relative rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:border-neutral-800 dark:bg-neutral-950"
              style={{ width: node.width + PANEL_EXTRA, boxSizing: "border-box" }}
            >
              {/* 富文本输入框（@ 引用「图片N」内联绑定参考图）：风格/标记/聚焦 作前置工具、展开作后置 */}
              <PromptRefEditor
                refs={refs}
                zoom={zoom}
                value={node.prompt || ""}
                onChange={(v) => updateNode(node.id, { prompt: v })}
                onSubmit={() => { if (!generating && node.prompt?.trim()) handleGenerate(); }}
                placeholder="根据图片1的主体或位置参考，输入你的生成描述；输入 @ 可引用已连接图片"
                leading={
                  <>
                    {[{ icon: Box, label: "风格" }, { icon: MapPin, label: "标记" }, { icon: Focus, label: "聚焦" }].map(({ icon: Icon, label }) => (
                      <button key={label} onMouseDown={stop} className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-neutral-200 bg-white text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </>
                }
                trailing={
                  <div className="flex items-center gap-0.5">
                    <button onMouseDown={stop} onClick={(e) => { stop(e); const t = node.prompt?.trim(); if (t) navigator.clipboard?.writeText(t)?.then(() => toast.success("已复制提示词"), () => toast.error("复制失败")); }} title="复制提示词" className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button onMouseDown={stop} onClick={(e) => { stop(e); setPromptExpanded(true); }} title="展开编辑" className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                }
              />
              <PromptEditorModal
                open={promptExpanded}
                onClose={() => setPromptExpanded(false)}
                value={node.prompt || ""}
                onChange={(v) => updateNode(node.id, { prompt: v })}
                refs={refs}
                placeholder="输入你的生成描述；输入 @ 可引用已连接图片"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={imageModels} value={selectedModelId} onChange={setSelectedModelId} />
                  <QualityRatioPicker
                    value={qualityRatio}
                    onChange={setQualityRatio}
                    qualities={formatConfig.qualities}
                    clarities={formatConfig.clarities}
                    ratios={formatConfig.ratios}
                    compact
                  />
                  <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Camera className="h-3.5 w-3.5" />
                    摄像机
                  </button>
                  <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Maximize2 className="h-3.5 w-3.5" />
                    全景
                  </button>
                  <button onMouseDown={stop} className="rounded-md p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="翻译/润色">
                    <Languages className="h-3.5 w-3.5" />
                  </button>
                  <button onMouseDown={stop} className="rounded-md p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="高级参数">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                  <div className="relative">
                    <button onMouseDown={stop} onClick={(e) => { stop(e); setBatchOpen((v) => !v); }} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {batchCount}张
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {batchOpen && (
                      <div onMouseDown={stop} className="absolute bottom-full left-0 z-30 mb-1 w-20 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                        {[1, 2, 4].map((n) => (
                          <button
                            key={n}
                            onMouseDown={stop}
                            onClick={(e) => { stop(e); setBatchCount(n); setBatchOpen(false); }}
                            className={`block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${batchCount === n ? "font-medium text-blue-600 dark:text-blue-400" : ""}`}
                          >
                            {n}张
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="flex items-center gap-0.5 text-xs text-neutral-500">
                    <Zap className="h-3 w-3 text-amber-500" fill="currentColor" />
                    {pointCost * batchCount}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); handleGenerate(); }}
                    disabled={generating || !node.prompt?.trim()}
                    title={generating ? "生成中..." : "开始生成"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      generating || !node.prompt?.trim()
                        ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                        : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    }`}
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </NodeChrome>
        )}
      </div>
    </div>
  );
});
