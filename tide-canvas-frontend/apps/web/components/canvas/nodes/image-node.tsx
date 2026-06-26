"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import {
  Image as ImageIcon, Upload, Plus, Maximize2, Box, MapPin, Copy,
  Camera, ArrowUp, ChevronDown, ChevronRight, Zap, Download, X, Minimize2,
  ArrowLeft, LayoutGrid, Layers,
  Images, Orbit, Sun, Table, Brush, FlipHorizontal2,
  Grid2x2, Hash, RotateCcw,
} from "lucide-react";
import { QualityRatioPicker, parseRatio, RATIO_OPTIONS, QUALITY_OPTIONS, CLARITY_OPTIONS, type QualityRatioValue } from "./quality-ratio-picker";
import { ModelPicker } from "./model-picker";
import { PromptRefEditor, PromptEditorModal } from "./prompt-ref-editor";
import { PanoramaViewer } from "./panorama-viewer";
import { InlinePanorama, type InlinePanoramaApi } from "./inline-panorama";
import { type RefItem } from "./prompt-ref-utils";
import { NodeChrome } from "./base/node-chrome";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { sliceImageGrid } from "@/lib/image-slice";
import { useAuth } from "@/hooks/use-auth";
import { applyTeamFactor } from "@/lib/points";
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
const IMAGE_CARD_BASE_WIDTH = 608;
const IMAGE_CARD_MAX_HEIGHT = 420;

function fixedRatioWidth(aspect: number): number | null {
  if (Math.abs(aspect - 9 / 16) < 0.001) return 345;
  if (Math.abs(aspect - 1 / 2) < 0.001) return 350;
  if (Math.abs(aspect - 2) < 0.001) return 694;
  return null;
}

function fitCardSize(aspect: number, maxW = IMAGE_CARD_BASE_WIDTH, maxH = IMAGE_CARD_MAX_HEIGHT) {
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

/** 是否为比例选择器里存在的明确比例（排除 auto/空值），用于比例继承判断 */
function isStandardRatio(r?: string | null): r is string {
  return !!r && r !== "auto" && RATIO_OPTIONS.some((o) => o.value === r);
}

// 提示词面板比图片卡片左右各宽出的总量（仅未生成图片时显示），居中伸出让底部控件更宽松
const PANEL_EXTRA = 80;

// 全景扩图提示词：让模型把当前图扩展为可环绕的 360° 全景（比例跟随源图节点）
const panoramaPrompt = (ratio: string) =>
  `将这张图扩展生成 360° 环绕全景图（equirectangular panorama，宽高比 ${ratio}）。必须让画面最左边缘与最右边缘无缝闭合，纹理、光照、颜色和透视连续，不能出现垂直拼接线、色块断层或重复硬边。向四周自然延展场景，保持主体、风格与光照一致，适合球面环绕观看。`;

const MULTI_ANGLE_DEFAULT = { yaw: -28, pitch: -8, zoom: 0, wideLens: false };
const ANGLE_CUBE = { w: 164, h: 92, d: 92 };
const MULTI_ANGLE_PRESETS = [
  { label: "自定义", ...MULTI_ANGLE_DEFAULT },
  { label: "鱼眼视角", yaw: -42, pitch: 6, zoom: -12, wideLens: true },
  { label: "倾斜视角", yaw: -36, pitch: -22, zoom: 8, wideLens: false },
  { label: "正面俯拍", yaw: 0, pitch: -32, zoom: 4, wideLens: false },
  { label: "正面仰拍", yaw: 0, pitch: 24, zoom: 6, wideLens: false },
  { label: "全景俯拍", yaw: -54, pitch: -36, zoom: -8, wideLens: true },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const COMMON_RATIOS = [
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
  { label: "2:1", value: 2 },
];

const closestRatioLabel = (aspect: number) =>
  COMMON_RATIOS.reduce((best, item) => (Math.abs(item.value - aspect) < Math.abs(best.value - aspect) ? item : best), COMMON_RATIOS[0]).label;

// memo 化：仅当自身 props（node / 选中 / 拖拽 / 连接目标）变化时重渲染，
// 画布平移、其他节点拖动都不会触发本节点重渲染。
export const ImageNode = memo(function ImageNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { user } = useAuth(); // 团队价：消耗按 inTeam 系数加价显示
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
  // 内嵌全景：三分网格开关 + 复位视角（由卡片上方专用工具栏控制）
  const [panoGrid, setPanoGrid] = useState(false);
  const panoApiRef = useRef<InlinePanoramaApi | null>(null);
  const [angleOpen, setAngleOpen] = useState(false);
  const [anglePreset, setAnglePreset] = useState("自定义");
  const [angleYaw, setAngleYaw] = useState(MULTI_ANGLE_DEFAULT.yaw);
  const [anglePitch, setAnglePitch] = useState(MULTI_ANGLE_DEFAULT.pitch);
  const [angleZoom, setAngleZoom] = useState(MULTI_ANGLE_DEFAULT.zoom);
  const [wideLens, setWideLens] = useState(MULTI_ANGLE_DEFAULT.wideLens);
  const angleDragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const [imageModels, setImageModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  // ===== 比例默认值：与上游连接节点统一 =====
  // 优先级：本节点钉死的比例（如 720° 全景节点 aspectRatio="2:1"）→ 第一个有明确比例的
  // 上游连接节点（全景源按 2:1）→ 兜底 16:9。仅作默认值：用户手动改过比例后不再跟随。
  const upstreamRatio = useCanvasStore((s) => {
    for (const c of s.connections) {
      if (c.targetId !== node.id) continue;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      if (!src) continue;
      if (src.is360) return "2:1";
      if (isStandardRatio(src.aspectRatio)) return src.aspectRatio;
    }
    return null;
  });
  const defaultRatio = (isStandardRatio(node.aspectRatio) ? node.aspectRatio : null) ?? upstreamRatio;
  const ratioTouchedRef = useRef(false);
  const [qualityRatio, setQualityRatio] = useState<QualityRatioValue>({
    quality: "standard",
    clarity: "2K",
    ratio: defaultRatio ?? "16:9",
  });
  // 默认比例变化（如事后连入全景图）且用户未手动改过 → 渲染期同步跟随（官方「props 变化调整 state」模式）
  const [lastDefaultRatio, setLastDefaultRatio] = useState(defaultRatio);
  if (defaultRatio !== lastDefaultRatio) {
    setLastDefaultRatio(defaultRatio);
    if (defaultRatio && !ratioTouchedRef.current) {
      setQualityRatio((s) => ({ ...s, ratio: defaultRatio }));
    }
  }
  // 一次出图张数（批量）：全部存入本节点 images，组图交互展示
  const [batchCount, setBatchCount] = useState(1);
  const [batchOpen, setBatchOpen] = useState(false);
  // 组图：展示主图+堆叠徽标，点徽标「展开」拆成多个独立图片节点
  const groupImages = node.images && node.images.length > 1 ? node.images : null;
  // 已展开的子节点 id（${node.id}_g{n}），响应式 —— 徽标据此在「展开 / 收起」间切换
  const expandedChildIds = useCanvasStore((s) => {
    if (!groupImages) return "";
    const prefix = `${node.id}_g`;
    return s.nodes.filter((n) => n.id.startsWith(prefix) && /^\d+$/.test(n.id.slice(prefix.length))).map((n) => n.id).join(",");
  });
  const isGroupExpanded = expandedChildIds.length > 0;
  // 已生成图片的真实宽高比（onLoad 时测量），用于让卡片严丝合缝贴合图片
  const [imgAspectState, setImgAspectState] = useState<{ src: string; aspect: number } | null>(null);
  const imgAspect = imgAspectState && imgAspectState.src === node.imageSrc ? imgAspectState.aspect : null;
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";
  const nodeUploading = uploading || node.uploading === true;
  const nodeUploadPct = uploading ? uploadPct : node.uploadProgress ?? 0;
  const uploadPreviewSrc = localPreview || node.imageSrc || null;
  const panoramaSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.sourceId === node.id)
      .map((c) => {
        const target = s.nodes.find((n) => n.id === c.targetId);
        return target?.is360 ? `${target.id}~${target.imageSrc || ""}~${target.status || ""}` : "";
      })
      .filter(Boolean)
      .join("|")
  );
  const existingPanorama = useMemo(() => {
    const st = useCanvasStore.getState();
    const conn = st.connections.find((c) => {
      if (c.sourceId !== node.id) return false;
      const target = st.nodes.find((n) => n.id === c.targetId);
      return target?.type === "image" && target.is360;
    });
    return conn ? st.nodes.find((n) => n.id === conn.targetId) : undefined;
  }, [node.id, panoramaSig]);
  const panoramaGenerating = existingPanorama ? isGenerating(existingPanorama.id) || existingPanorama.status === "generating" : false;

  useEffect(() => {
    if (node.imageSrc && node.status === "error" && !generating && !node.uploading) {
      updateNode(node.id, { status: "success" });
    }
  }, [generating, node.id, node.imageSrc, node.status, node.uploading, updateNode]);

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
  const requestedRatio = node.aspectRatio || (!node.imageSrc ? qualityRatio.ratio : "auto");
  const ratioParsed = parseRatio(requestedRatio);
  const cardAspect = ratioParsed ? ratioParsed.w / ratioParsed.h : (node.imageSrc && imgAspect ? imgAspect : 4 / 3);
  const { w: cardW, h: cardH } = fitCardSize(cardAspect);
  const promptPanelW = Math.max(640, cardW + PANEL_EXTRA);
  const selectedModel = imageModels.find((m) => m.modelId === selectedModelId);
  const formatConfig: { qualities?: string[]; clarities?: string[]; ratios?: string[]; batchSizes?: number[]; gridOutput?: boolean; pricing?: Record<string, Record<string, number>> } = (() => {
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

  // 出图张数选项：由模型 config.batchSizes 驱动(如 Midjourney 固定一组 4 张配 [4])，未配置用默认档位
  const batchOptions = formatConfig.batchSizes?.length ? formatConfig.batchSizes : [1, 2, 4];
  // 各维度可选值：undefined(模型未配置) = 默认全集；空数组(后台明确全不勾) = 模型无此维度，选择器隐藏且参数不下发
  const qualityValues = formatConfig.qualities ?? QUALITY_OPTIONS.map((q) => q.value);
  const clarityValues = formatConfig.clarities ?? [...CLARITY_OPTIONS];
  const ratioValues = formatConfig.ratios;
  const hasRatioDim = !ratioValues || ratioValues.length > 0;
  // 切换模型后当前张数/画质/清晰度/比例不在该模型的可选档位 → 自动校正为其首个档位
  useEffect(() => {
    if (!batchOptions.includes(batchCount)) {
      setBatchCount(batchOptions[0]);
    }
    setQualityRatio((s) => {
      let next = s;
      if (qualityValues.length && !qualityValues.includes(s.quality)) {
        next = { ...next, quality: qualityValues[0] as QualityRatioValue["quality"] };
      }
      if (clarityValues.length && !clarityValues.includes(s.clarity)) {
        next = { ...next, clarity: clarityValues[0] as QualityRatioValue["clarity"] };
      }
      if (ratioValues?.length && !ratioValues.includes(s.ratio)) {
        next = { ...next, ratio: ratioValues[0] };
      }
      return next;
    });
    // 各可选数组由 selectedModelId 派生(引用每次渲染变化)，不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, batchCount]);

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
      gridOutput: formatConfig.gridOutput,
      input: {
        prompt: node.prompt,
        ...(imageList.length ? { imageList, sourceImage: imageList[0], references: imageList.slice(1) } : {}),
        // 模型无某维度(后台全不勾)时该参数不下发，避免上游收到其不支持的字段
        ...(hasRatioDim ? { aspectRatio: qualityRatio.ratio, aspect_ratio: qualityRatio.ratio, ratio: qualityRatio.ratio } : {}),
        ...(qualityValues.length ? { quality: qualityRatio.quality } : {}),
        ...(clarityValues.length ? { clarity: qualityRatio.clarity, resolution: qualityRatio.clarity } : {}),
        ...(batchCount > 1 ? { batchCount } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate, node.id, node.prompt, node.imageSrc, qualityRatio, selectedModelId, refs, batchCount]);

  const handlePromptChange = useCallback((value: string) => {
    updateNode(node.id, {
      prompt: value,
      ...(node.status === "error" ? { status: node.imageSrc ? "success" : "idle" } : {}),
    });
  }, [node.id, node.imageSrc, node.status, updateNode]);

  // 全景：先 AI 生成 360° 全景扩图（新建图片节点并连线），完成后自动打开 360 查看器。
  // 比例跟随源图节点：源图钉死比例 → 当前面板选的比例 → 16:9 托底（16:9 源出 16:9、9:16 源出 9:16）。
  const generatePanorama = useCallback(() => {
    if (!node.imageSrc) { toast.error("请先生成或上传图片"); return; }
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const panoRatio = (isStandardRatio(node.aspectRatio) ? node.aspectRatio : null)
      ?? (isStandardRatio(qualityRatio.ratio) ? qualityRatio.ratio : null)
      ?? "16:9";
    const pr = parseRatio(panoRatio);
    const panoAspect = pr ? pr.w / pr.h : 16 / 9;
    // 卡片尺寸与图片节点渲染规则一致：横图限宽、竖图限高
    const cw = panoAspect >= 1 ? IMAGE_CARD_BASE_WIDTH : Math.round(IMAGE_CARD_BASE_WIDTH * panoAspect);
    const ph = panoAspect >= 1 ? Math.round(IMAGE_CARD_BASE_WIDTH / panoAspect) : IMAGE_CARD_BASE_WIDTH;
    // 放到右侧列下方，避免与已有节点堆叠
    const targetX = node.x + IMAGE_CARD_BASE_WIDTH + 80;
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
      title: "720° 全景图",
      status: "idle",
      is360: true,
      aspectRatio: panoRatio,
    }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
    st.selectNode(nid);
    toast.info(`正在生成 ${panoRatio} 的 360 全景图`);
    generate({
      nodeId: nid,
      handler: "image_to_image",
      modelId: selectedModelId || "default",
      input: {
        prompt: panoramaPrompt(panoRatio),
        imageList: [node.imageSrc],
        sourceImage: node.imageSrc,
        aspectRatio: panoRatio,
        aspect_ratio: panoRatio,
        ratio: panoRatio,
        quality: qualityRatio.quality,
        clarity: qualityRatio.clarity,
        resolution: qualityRatio.clarity,
      },
      // 生成后不自动弹全屏：结果已在新的 720° 节点内嵌环视；需要全屏再点工具栏全屏/「查看全景」
    });
  }, [generate, node.id, node.x, node.y, node.width, node.aspectRatio, node.imageSrc, qualityRatio, selectedModelId]);

  const handlePanorama = useCallback(() => {
    if (!node.imageSrc) {
      toast.error("请先生成或上传图片");
      return;
    }
    if (node.is360) {
      setPanoramaSrc(node.imageSrc);
      setPanoramaOpen(true);
      return;
    }
    if (existingPanorama?.imageSrc) {
      setPanoramaSrc(existingPanorama.imageSrc);
      setPanoramaOpen(true);
      return;
    }
    if (existingPanorama && panoramaGenerating) {
      useCanvasStore.getState().selectNode(existingPanorama.id);
      toast.info("全景图正在生成中");
      return;
    }
    generatePanorama();
  }, [existingPanorama, generatePanorama, node.imageSrc, node.is360, panoramaGenerating]);

  // 全景「当前视角截图」→ 上传 → 右侧生成一个连线图片节点
  const handlePanoCapture = useCallback(async () => {
    const dataUrl = panoApiRef.current?.capture();
    if (!dataUrl) { toast.error("截图失败，请重试"); return; }
    const blob = await (await fetch(dataUrl)).blob();
    const res = await uploadFileSmart(new File([blob], "全景截图.png", { type: "image/png" }));
    if (!res.success) { toast.error(res.message || "截图上传失败"); return; }
    const st = useCanvasStore.getState();
    const capH = Math.round(node.width / 2);
    const nid = generateNodeId();
    st.addNode({ id: nid, type: "image", x: node.x + node.width + 80, y: node.y, width: node.width, height: capH, contentW: node.width, contentH: capH, title: "全景截图", imageSrc: res.data.fileUrl, status: "success" }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}_c`, sourceId: node.id, targetId: nid }, false);
    st.selectNode(nid);
    toast.success("已截取当前视角");
  }, [node.id, node.x, node.y, node.width]);

  // 全景「4 大视角截图」→ 当前/+90/+180/+270 平视各截一张 → 各上传 → 右侧竖排 4 个连线图片节点
  const handlePanoCapture4 = useCallback(async () => {
    const urls = panoApiRef.current?.capture4();
    if (!urls || urls.length === 0) { toast.error("截图失败，请重试"); return; }
    toast.info("正在截取 4 个视角…");
    const st = useCanvasStore.getState();
    const capH = Math.round(node.width / 2);
    const baseX = node.x + node.width + 80;
    let ok = 0;
    for (let i = 0; i < urls.length; i++) {
      const blob = await (await fetch(urls[i])).blob();
      const res = await uploadFileSmart(new File([blob], `全景视角${i + 1}.png`, { type: "image/png" }));
      if (!res.success) continue;
      const nid = generateNodeId();
      st.addNode({ id: nid, type: "image", x: baseX, y: node.y + i * (capH + 24), width: node.width, height: capH, contentW: node.width, contentH: capH, title: `全景视角 ${i + 1}`, imageSrc: res.data.fileUrl, status: "success" }, i === 0);
      st.addConnection({ id: `conn_${node.id}_${nid}_${i}`, sourceId: node.id, targetId: nid }, false);
      ok++;
    }
    if (ok > 0) toast.success(`已截取 ${ok} 个视角`); else toast.error("截图失败");
  }, [node.id, node.x, node.y, node.width]);

  const multiAngleRatio = useMemo(() => {
    if (node.aspectRatio && parseRatio(node.aspectRatio)) return node.aspectRatio;
    if (node.imageSrc) return closestRatioLabel(cardAspect);
    if (qualityRatio.ratio && qualityRatio.ratio !== "auto") return qualityRatio.ratio;
    return closestRatioLabel(cardAspect);
  }, [cardAspect, node.aspectRatio, node.imageSrc, qualityRatio.ratio]);

  const applyAnglePreset = useCallback((label: string) => {
    setAnglePreset(label);
    const preset = MULTI_ANGLE_PRESETS.find((item) => item.label === label);
    if (!preset || label === "自定义") return;
    setAngleYaw(preset.yaw);
    setAnglePitch(preset.pitch);
    setAngleZoom(preset.zoom);
    setWideLens(preset.wideLens);
  }, []);

  const resetMultiAngle = useCallback(() => {
    setAnglePreset("自定义");
    setAngleYaw(MULTI_ANGLE_DEFAULT.yaw);
    setAnglePitch(MULTI_ANGLE_DEFAULT.pitch);
    setAngleZoom(MULTI_ANGLE_DEFAULT.zoom);
    setWideLens(MULTI_ANGLE_DEFAULT.wideLens);
  }, []);

  const buildMultiAnglePrompt = useCallback(() => {
    const yawText = angleYaw < -6 ? `镜头向左旋转约 ${Math.abs(angleYaw)} 度` : angleYaw > 6 ? `镜头向右旋转约 ${angleYaw} 度` : "镜头保持正面";
    const pitchText = anglePitch < -6 ? `从上方向下俯拍约 ${Math.abs(anglePitch)} 度` : anglePitch > 6 ? `从下方向上仰拍约 ${anglePitch} 度` : "垂直角度保持平视";
    const zoomText = angleZoom < -5 ? "镜头略微拉远，保留更多环境" : angleZoom > 5 ? "镜头略微推进，主体更突出" : "主体大小保持接近原图";
    const lensText = wideLens ? "使用广角镜头效果，边缘透视自然扩展但不要畸变主体。" : "使用自然标准镜头，避免夸张畸变。";
    return [
      "基于参考图生成同一主体的多角度图片，必须保持主体身份、服饰/材质、色彩、光照、背景风格和细节一致，只改变摄像机角度与构图。",
      `${yawText}，${pitchText}，${zoomText}。`,
      lensText,
      `输出画幅保持 ${multiAngleRatio}，不要生成 360 全景图，不要改变为 2:1，画面边缘完整自然。`,
    ].join(" ");
  }, [anglePitch, angleYaw, angleZoom, multiAngleRatio, wideLens]);

  const handleGenerateMultiAngle = useCallback(() => {
    if (!node.imageSrc) {
      toast.error("请先生成或上传图片");
      return;
    }
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const targetX = node.x + cardW + 80;
    const colNodes = st.nodes.filter((n) => {
      const nw = n.contentW ?? n.width;
      return n.x < targetX + cardW && n.x + nw > targetX;
    });
    const targetY = colNodes.length
      ? Math.max(...colNodes.map((n) => n.y + (n.contentH ?? n.height ?? 0))) + 24
      : node.y;

    st.addNode({
      id: nid,
      type: "image",
      x: targetX,
      y: targetY,
      width: IMAGE_CARD_BASE_WIDTH,
      height: cardH,
      contentW: cardW,
      contentH: cardH,
      title: "多角度",
      status: "idle",
      aspectRatio: multiAngleRatio,
    }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
    st.selectNode(nid);
    setAngleOpen(false);
    generate({
      nodeId: nid,
      handler: "image_to_image",
      modelId: selectedModelId || "default",
      input: {
        prompt: buildMultiAnglePrompt(),
        imageList: [node.imageSrc],
        sourceImage: node.imageSrc,
        aspectRatio: multiAngleRatio,
        aspect_ratio: multiAngleRatio,
        ratio: multiAngleRatio,
        quality: qualityRatio.quality,
        clarity: qualityRatio.clarity,
        resolution: qualityRatio.clarity,
      },
    });
  }, [buildMultiAnglePrompt, cardH, cardW, generate, multiAngleRatio, node.id, node.imageSrc, node.x, node.y, qualityRatio.clarity, qualityRatio.quality, selectedModelId]);

  const beginAngleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    angleDragRef.current = { x: e.clientX, y: e.clientY, yaw: angleYaw, pitch: anglePitch };
    setAnglePreset("自定义");
  }, [anglePitch, angleYaw]);

  const updateAngleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!angleDragRef.current) return;
    e.stopPropagation();
    const drag = angleDragRef.current;
    setAngleYaw(clamp(Math.round(drag.yaw + (e.clientX - drag.x) * 0.45), -90, 90));
    setAnglePitch(clamp(Math.round(drag.pitch - (e.clientY - drag.y) * 0.35), -90, 90));
  }, []);

  const endAngleDrag = useCallback(() => {
    angleDragRef.current = null;
  }, []);

  // 宫格切分：前端 canvas 秒切立即铺节点(本地 blob 即时显示)，随后后台静默上传、无感替换为远端地址
  const handleGridSplit = useCallback(async (rows: number, cols: number, cells: number[] | null = null) => {
    if (!node.imageSrc || splitting) return;
    setGridMenuOpen(false);
    setSplitting(true);
    try {
      const slices = await sliceImageGrid(node.imageSrc, rows, cols, cells);
      const store = useCanvasStore.getState();
      // 每块宽高比 = 原图比例 × rows/cols；据此排成紧凑网格，按原格子位置摆放
      const origAR = (node.contentW ?? node.width) / ((node.contentH ?? node.height) || 1);
      const cellAR = (origAR * rows) / cols;
      // 切片节点与源节点保持一致大小（同宽）
      const CELL_W = node.contentW ?? node.width;
      const CELL_H = Math.max(60, Math.round(CELL_W / (cellAR || 1)));
      const gap = 24;
      const startX = node.x + (node.contentW ?? node.width) + 100;
      const placed = slices.map((s, i) => {
        const r = Math.floor(s.cellIndex / cols);
        const c = s.cellIndex % cols;
        const nid = generateNodeId();
        const blobUrl = URL.createObjectURL(s.blob);
        store.addNode(
          {
            id: nid,
            type: "image",
            x: startX + c * (CELL_W + gap),
            y: node.y + r * (CELL_H + gap),
            width: CELL_W,
            height: CELL_H,
            title: `切片 ${s.cellIndex + 1}`,
            imageSrc: blobUrl,
            status: "idle",
          },
          i === 0, // 仅首块记入历史，整批一次撤销
        );
        // 切片连回原节点，标明来源
        store.addConnection(
          { id: `conn_${nid}_${node.id}`, sourceId: node.id, targetId: nid },
          false,
        );
        return { nid, blobUrl, slice: s };
      });
      toast.success(`已切分为 ${slices.length} 块`);
      // 后台静默上传：成功后把节点 imageSrc 从本地 blob 换成远端地址(刷新/引用/保存均依赖远端 URL)
      placed.forEach(async ({ nid, blobUrl, slice }) => {
        try {
          const up = await uploadFileSmart(
            new File([slice.blob], `grid_${slice.cellIndex + 1}.png`, { type: "image/png" }));
          if (!up.success || !up.data?.fileUrl) throw new Error(up.message || "upload failed");
          useCanvasStore.getState().updateNode(nid, { imageSrc: up.data.fileUrl });
          // 延迟回收 blob，等 React 用远端地址完成重渲，避免替换瞬间闪裂
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        } catch {
          toast.error(`切片 ${slice.cellIndex + 1} 上传失败，该切片刷新后将丢失`);
        }
      });
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
  const downloadUrl = useCallback(async (url: string, name: string) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const api = `/api/files/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
    const res = await fetch(api, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  }, []);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!node.imageSrc || downloading) return;
    setDownloading(true);
    try {
      await downloadUrl(node.imageSrc, node.title || "image");
    } catch {
      toast.error("下载失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  }, [node.imageSrc, node.title, downloading, downloadUrl]);

  // 组图展开：把 node.images 拆成多个独立图片节点(右侧网格铺开、各自连回源节点)，与「宫格切分」一致。
  // 子节点用确定性 ID(${源id}_g${i})，已存在则跳过 —— 保证幂等：重复点击不再叠加覆盖，删掉某张还能补建。
  const handleExpandGroup = useCallback(() => {
    if (!groupImages) return;
    const store = useCanvasStore.getState();
    const existing = new Set(store.nodes.map((n) => n.id));
    const cols = groupImages.length <= 3 ? groupImages.length : 2;
    const CELL_W = node.contentW ?? node.width;
    const CELL_H = node.contentH ?? node.height ?? CELL_W;
    const gap = 24;
    const startX = node.x + (node.contentW ?? node.width) + 100;
    let created = 0;
    groupImages.forEach((url, i) => {
      const nid = `${node.id}_g${i}`;
      if (existing.has(nid)) return; // 已展开过则跳过，避免重复创建导致多层覆盖
      const r = Math.floor(i / cols);
      const c = i % cols;
      store.addNode({
        id: nid,
        type: "image",
        x: startX + c * (CELL_W + gap),
        y: node.y + r * (CELL_H + gap),
        width: CELL_W,
        height: CELL_H,
        contentW: CELL_W,
        contentH: CELL_H,
        title: `组图 ${i + 1}`,
        imageSrc: url,
        status: "success",
      }, created === 0); // 本批首个记入历史，整批一次撤销
      store.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
      created++;
    });
    if (created > 0) toast.success(`已展开为 ${created} 个节点`);
    else toast.info("已展开");
  }, [groupImages, node.id, node.x, node.y, node.width, node.height, node.contentW, node.contentH]);

  // 组图收起：删除展开出的子节点(连带删边、一步撤销)，回到组图态
  const handleCollapseGroup = useCallback(() => {
    const store = useCanvasStore.getState();
    const prefix = `${node.id}_g`;
    const ids = store.nodes
      .filter((n) => n.id.startsWith(prefix) && /^\d+$/.test(n.id.slice(prefix.length)))
      .map((n) => n.id);
    if (!ids.length) return;
    store.removeNodes(ids);
    toast.info("已收起");
  }, [node.id]);

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
      setAngleOpen(false);
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
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
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
              disabled={nodeUploading}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {nodeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              上传
            </button>
          </NodeChrome>
        )}
        {/* 已生成 + 非预览：顶部操作工具栏（恒定大小独立胶囊，吸附卡片左上方）。
            zIndex 抬到端口(默认 10)之上，避免「宫格切分」下拉被端口 + 盖住 */}
        {showAuxUI && node.imageSrc && !gridPreview && !node.is360 && (
          <NodeChrome zoom={zoom} placement="top-center" gap={10} zIndex={20}>
            <div
              onMouseDown={stop}
              className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {/* 360 全景：普通图生成 2:1 equirectangular 全景；已有结果时直接打开查看器。 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); handlePanorama(); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {panoramaGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
                {panoramaGenerating ? "生成中" : node.is360 || existingPanorama?.imageSrc ? "查看全景" : "720°全景"}
              </button>
              {/* 多角度 */}
              <button onMouseDown={stop} onClick={(e) => { stop(e); setAngleOpen((v) => !v); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
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
                <span className="flex h-4 items-center rounded bg-neutral-200 px-1 text-[10px] font-medium leading-none text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">HD</span>
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
        {/* 720° 全景：专用顶部工具栏（网格 / 复位 / 查看全景 / 下载）—— 浮在卡片上方，不压住画面 */}
        {showAuxUI && node.imageSrc && node.is360 && !gridPreview && (
          <NodeChrome zoom={zoom} placement="top-center" gap={10} zIndex={20}>
            <div onMouseDown={stop} className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <button onMouseDown={stop} onClick={(e) => { stop(e); handlePanoCapture(); }} title="当前视角截图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Camera className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); handlePanoCapture4(); }} title="4大视角截图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Grid2x2 className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); setPanoGrid((v) => !v); }} title="构图参考线" className={`rounded-xl p-2 transition-colors ${panoGrid ? "bg-neutral-100 text-blue-600 dark:bg-neutral-800 dark:text-blue-400" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}><Hash className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); panoApiRef.current?.reset(); }} title="复位视角" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><RotateCcw className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={(e) => { stop(e); handlePanorama(); }} title="全屏查看" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Maximize2 className="h-4 w-4" /></button>
              <button onMouseDown={stop} onClick={handleDownload} disabled={downloading} title="下载" className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>
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

        {/* 多角度：跟随图片节点的内联控制面板 */}
        {showAuxUI && angleOpen && node.imageSrc && !gridPreview && (
          <NodeChrome zoom={zoom} placement="bottom-center" gap={18} zIndex={30}>
            <div
              onMouseDown={stop}
              className="w-[562px] overflow-hidden rounded-[14px] bg-white p-5 text-neutral-800 shadow-2xl ring-1 ring-neutral-200/80 dark:bg-[#29292b] dark:text-white dark:ring-white/8"
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">拖动立方体调整角度</h3>
                <button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); setAngleOpen(false); }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/80"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-[240px_1fr] gap-4">
                <div
                  className="relative flex h-[240px] cursor-grab items-center justify-center overflow-hidden rounded-[13px] border border-neutral-200 bg-neutral-50 active:cursor-grabbing dark:border-white/8 dark:bg-[#2f2f31]"
                  onMouseDown={beginAngleDrag}
                  onMouseMove={updateAngleDrag}
                  onMouseUp={endAngleDrag}
                  onMouseLeave={endAngleDrag}
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(15,23,42,0.08),transparent_38%)] dark:bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.08),transparent_38%)]" />
                  <div
                    className="relative"
                    style={{ width: ANGLE_CUBE.w, height: ANGLE_CUBE.h, perspective: 680, transform: `scale(${1 + angleZoom / 140})` }}
                  >
                    <div
                      className="absolute left-1/2 top-1/2 shadow-xl"
                      style={{
                        width: ANGLE_CUBE.w,
                        height: ANGLE_CUBE.h,
                        transformStyle: "preserve-3d",
                        transform: `translate(-50%, -50%) rotateX(${anglePitch}deg) rotateY(${angleYaw}deg)`,
                        transition: angleDragRef.current ? "none" : "transform 180ms ease",
                      }}
                    >
                      <div
                        className="absolute left-1/2 top-1/2 overflow-hidden rounded-md bg-neutral-900 ring-1 ring-black/10 [backface-visibility:hidden] dark:ring-white/18"
                        style={{
                          width: ANGLE_CUBE.w,
                          height: ANGLE_CUBE.h,
                          transform: `translate(-50%, -50%) translateZ(${ANGLE_CUBE.d / 2}px)`,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={node.imageSrc} alt="" className="h-full w-full object-cover" draggable={false} />
                      </div>
                      {/* 其余 5 个面（同色）：各面渲染时比真实尺寸大 2px，相邻面在公共棱边互相重叠 1px，
                          消除透视下面与面之间露出背景底色的「裂缝」 */}
                      {[
                        { label: "后", transform: `translate(-50%, -50%) rotateY(180deg) translateZ(${ANGLE_CUBE.d / 2}px)`, width: ANGLE_CUBE.w, height: ANGLE_CUBE.h },
                        { label: "上", transform: `translate(-50%, -50%) rotateX(90deg) translateZ(${ANGLE_CUBE.h / 2}px)`, width: ANGLE_CUBE.w, height: ANGLE_CUBE.d },
                        { label: "下", transform: `translate(-50%, -50%) rotateX(-90deg) translateZ(${ANGLE_CUBE.h / 2}px)`, width: ANGLE_CUBE.w, height: ANGLE_CUBE.d },
                        { label: "左", transform: `translate(-50%, -50%) rotateY(-90deg) translateZ(${ANGLE_CUBE.w / 2}px)`, width: ANGLE_CUBE.d, height: ANGLE_CUBE.h },
                        { label: "右", transform: `translate(-50%, -50%) rotateY(90deg) translateZ(${ANGLE_CUBE.w / 2}px)`, width: ANGLE_CUBE.d, height: ANGLE_CUBE.h },
                      ].map((face) => (
                        <div
                          key={face.label}
                          className="absolute left-1/2 top-1/2 flex items-center justify-center bg-[#d8d8d8] text-xs font-semibold text-neutral-500 [backface-visibility:hidden] dark:bg-[#626262] dark:text-white/55"
                          style={{ width: face.width + 2, height: face.height + 2, transform: face.transform }}
                        >
                          {face.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col">
                  <div className="mb-5 flex flex-wrap gap-2">
                    {MULTI_ANGLE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onMouseDown={stop}
                        onClick={(e) => { stop(e); applyAnglePreset(preset.label); }}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          anglePreset === preset.label
                            ? "bg-neutral-900 text-white dark:bg-white/28 dark:text-white"
                            : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-white/12 dark:text-white/82 dark:hover:bg-white/20 dark:hover:text-white"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-5">
                    {[
                      { label: "左右旋转", value: angleYaw, min: -90, max: 90, unit: "°", onChange: setAngleYaw },
                      { label: "垂直角度", value: anglePitch, min: -90, max: 90, unit: "°", onChange: setAnglePitch },
                      { label: "缩放", value: angleZoom, min: -30, max: 30, unit: "", onChange: setAngleZoom },
                    ].map((item) => (
                      <label key={item.label} className="grid grid-cols-[66px_1fr_30px] items-center gap-3 text-xs">
                        <span className="text-neutral-500 dark:text-white/45">{item.label}</span>
                        <input
                          type="range"
                          min={item.min}
                          max={item.max}
                          value={item.value}
                          onMouseDown={stop}
                          onChange={(e) => {
                            setAnglePreset("自定义");
                            item.onChange(Number(e.target.value));
                          }}
                          className="slider-thin"
                          style={{ "--pct": `${((item.value - item.min) / (item.max - item.min)) * 100}%` } as React.CSSProperties}
                        />
                        <span className="text-right font-semibold tabular-nums text-neutral-600 dark:text-white/65">{item.value > 0 ? "+" : ""}{item.value}{item.unit}</span>
                      </label>
                    ))}
                  </div>

                  <button
                    onMouseDown={stop}
                    onClick={(e) => {
                      stop(e);
                      setAnglePreset("自定义");
                      setWideLens((v) => !v);
                    }}
                    className="mt-5 grid grid-cols-[66px_1fr_34px] items-center gap-3 text-left text-xs"
                  >
                    <span className="font-medium text-neutral-600 dark:text-white/62">广角镜头</span>
                    <span />
                    <span className={`flex h-5 w-8 items-center rounded-full p-0.5 transition-colors ${wideLens ? "bg-neutral-900 dark:bg-neutral-900" : "bg-neutral-200 ring-1 ring-neutral-300 dark:bg-neutral-700 dark:ring-neutral-600"}`}>
                      <span className={`h-4 w-4 rounded-full transition-transform ${wideLens ? "translate-x-3 bg-white" : "bg-white dark:bg-neutral-300"}`} />
                    </span>
                  </button>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); resetMultiAngle(); }}
                  className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-700 dark:text-white/42 dark:hover:text-white/75"
                >
                  <span className="text-base leading-none">↻</span>
                  重置
                </button>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-xs text-neutral-400 dark:text-white/38">
                    <Zap className="h-3.5 w-3.5" fill="currentColor" />
                    {applyTeamFactor(pointCost, user)}
                    {user?.inTeam && <span className="text-[10px] font-medium text-amber-500">团队价</span>}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); handleGenerateMultiAngle(); }}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg shadow-neutral-950/20 transition-colors hover:bg-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                    title="生成"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </NodeChrome>
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

        {/* 组图：右侧堆叠纸张效果（置于主卡之下） */}
        {groupImages && (
          <>
            <div className="absolute rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                 style={{ left: 16, right: -16, top: 8, height: cardH - 16 }} />
            <div className="absolute rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                 style={{ left: 8, right: -8, top: 4, height: cardH - 8 }} />
          </>
        )}

        {/* 主图片区 - 始终显示（作为容器内唯一在流元素，决定容器尺寸） */}
        <div
          className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70" :
            isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600" : "ring-neutral-200 dark:ring-neutral-800"
          }`}
          style={{ width: cardW, height: cardH }}
        >
          {/* 组图徽标：在「展开为多个节点 / 收起」之间切换 */}
          {groupImages && !generating && (
            <button
              onMouseDown={stop}
              onClick={(e) => { stop(e); if (isGroupExpanded) handleCollapseGroup(); else handleExpandGroup(); }}
              title={isGroupExpanded ? "收起展开的节点" : "展开为多个节点"}
              className="absolute right-3 top-3 z-[7] flex items-center gap-1 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              {isGroupExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isGroupExpanded ? "收起" : `展开 ${groupImages.length} 张`}
            </button>
          )}
          {/* 生成中遮罩 */}
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600 dark:text-neutral-400">AI 生成中...</p>
              </div>
            </div>
          )}
          {/* 上传中遮罩：模糊预览 + 百分比 */}
          {nodeUploading && (
            <div className="absolute inset-0 z-[6] overflow-hidden">
              {uploadPreviewSrc ? (
                <img src={uploadPreviewSrc} alt="" className="h-full w-full scale-110 object-cover blur-xl" />
              ) : (
                <div className="h-full w-full bg-neutral-900" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <p className="text-sm text-white/90">上传中 ({nodeUploadPct}%) ...</p>
              </div>
            </div>
          )}
          {/* 错误状态 */}
          {node.status === "error" && !generating && !node.imageSrc && (
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
            node.is360 ? (
              <InlinePanorama src={node.imageSrc} gridOn={panoGrid} apiRef={panoApiRef} interactive={showAuxUI} />
            ) : (
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
                className="h-full w-full object-contain"
              />
            )
          ) : (
            <div className="relative h-full p-8 text-neutral-950 dark:text-neutral-100">
              <div className="absolute inset-x-0 top-[28%] flex justify-center">
                <svg className="h-16 w-16 text-neutral-400 dark:text-neutral-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="16.5" cy="7.5" r="2" />
                  <path d="M3 19.5 9.2 11l4.2 5.2 2.8-3.5 4.8 6.8H3z" />
                </svg>
              </div>
              <div className="absolute left-7 top-[45%]">
                <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">尝试：</p>
                <div className="flex flex-col items-start gap-3">
                  <button
                    onMouseDown={stop}
                    onClick={openFilePicker}
                    disabled={nodeUploading}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-900"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {nodeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    </span>
                    图生图
                  </button>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); toast.info("图片高清功能即将上线"); }}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-medium leading-none text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
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
          <NodeChrome zoom={zoom} placement="bottom-center" gap={18}>
            <div
              className="relative rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
              style={{ width: promptPanelW, boxSizing: "border-box" }}
            >
              {/* 富文本输入框（@ 引用「图片N」内联绑定参考图）：风格/标记/参考 作前置工具、展开作后置 */}
              <PromptRefEditor
                refs={refs}
                zoom={zoom}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                onSubmit={() => { if (!generating && node.prompt?.trim()) handleGenerate(); }}
                placeholder="可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜"
                leading={
                  <>
                    {[{ icon: Box, label: "风格" }, { icon: MapPin, label: "标记" }, { icon: Plus, label: "参考" }].map(({ icon: Icon, label }) => (
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
                onChange={handlePromptChange}
                refs={refs}
                placeholder="可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-nowrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={imageModels} value={selectedModelId} onChange={setSelectedModelId} />
                  <QualityRatioPicker
                    value={qualityRatio}
                    onChange={(v) => {
                      // 用户手动改过比例后，不再跟随上游连接节点的默认比例
                      if (v.ratio !== qualityRatio.ratio) ratioTouchedRef.current = true;
                      setQualityRatio(v);
                    }}
                    qualities={formatConfig.qualities}
                    clarities={formatConfig.clarities}
                    ratios={formatConfig.ratios}
                    compact
                  />
                  <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Camera className="h-3.5 w-3.5" />
                    摄像机
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <div className="relative">
                    <button onMouseDown={stop} onClick={(e) => { stop(e); setBatchOpen((v) => !v); }} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {batchCount}张
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {batchOpen && (
                      <div onMouseDown={stop} className="absolute bottom-full left-0 z-30 mb-1 w-20 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                        {batchOptions.map((n) => (
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
                  <span className="flex items-center gap-0.5 text-xs text-neutral-500">
                    <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                    {applyTeamFactor(pointCost * batchCount, user)}
                    {user?.inTeam && <span className="text-[10px] font-medium text-amber-500">团队价</span>}
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
