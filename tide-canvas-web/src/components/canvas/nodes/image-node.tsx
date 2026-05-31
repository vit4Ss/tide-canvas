"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import {
  Image as ImageIcon, Upload, Plus, Maximize2, Box, MapPin,
  Camera, ArrowUp, ChevronDown, Zap, Download, X,
} from "lucide-react";
import { QualityRatioPicker, parseRatio, type QualityRatioValue } from "./quality-ratio-picker";
import { ModelPicker } from "./model-picker";
import { NodeChrome } from "./base/node-chrome";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { fileApi, aiApi } from "@/lib/api";
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

const LINE_HEIGHT = 20;
const MIN_ROWS = 3;
const MAX_ROWS = 4;

/** 来自入边连接的可引用图片 */
interface RefItem {
  id: string;
  thumb: string;
  title: string;
  index: number;
}
// 提示词面板比图片卡片左右各宽出的总量（仅未生成图片时显示），居中伸出让底部控件更宽松
const PANEL_EXTRA = 80;

// memo 化：仅当自身 props（node / 选中 / 拖拽 / 连接目标）变化时重渲染，
// 画布平移、其他节点拖动都不会触发本节点重渲染。
export const ImageNode = memo(function ImageNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  // 当前画布缩放：外置组件按 1/zoom 反向缩放，保持恒定屏幕尺寸
  const zoom = useCanvasStore((s) => s.transform.k);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const [imageModels, setImageModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [qualityRatio, setQualityRatio] = useState<QualityRatioValue>({
    quality: "standard",
    clarity: "2K",
    ratio: "16:9",
  });
  // 已生成图片的真实宽高比（onLoad 时测量），用于让卡片严丝合缝贴合图片
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  useEffect(() => { setImgAspect(null); }, [node.imageSrc]);
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
    for (const c of st.connections) {
      if (c.targetId !== node.id) continue;
      const src = st.nodes.find((n) => n.id === c.sourceId);
      if (!src) continue;
      out.push({ id: src.id, thumb: src.imageSrc || src.videoSrc || "", title: src.title || "", index: out.length + 1 });
    }
    return out;
    // refsSig 作为相等触发器：仅当引用签名变化时才重建（body 内用 getState 非响应式读取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsSig, node.id]);
  const [refIds, setRefIds] = useState<string[]>([]);
  const selectedRefs = useMemo(() => refs.filter((r) => refIds.includes(r.id)), [refs, refIds]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const mentionList = useMemo(
    () => refs.filter(
      (r) => !refIds.includes(r.id) && (!mentionQuery || `图片${r.index}`.includes(mentionQuery) || String(r.index) === mentionQuery)
    ),
    [refs, refIds, mentionQuery]
  );

  const addRef = useCallback((id: string) => setRefIds((prev) => (prev.includes(id) ? prev : [...prev, id])), []);
  const removeRef = useCallback((id: string) => setRefIds((prev) => prev.filter((x) => x !== id)), []);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    updateNode(node.id, { prompt: v });
    const caret = e.target.selectionStart ?? v.length;
    const m = /@([^\s@]*)$/.exec(v.slice(0, caret));
    if (m && refs.length > 0) {
      setMentionQuery(m[1]);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const selectMention = (id: string) => {
    const v = node.prompt || "";
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? v.length;
    const newBefore = v.slice(0, caret).replace(/@([^\s@]*)$/, "");
    updateNode(node.id, { prompt: newBefore + v.slice(caret) });
    addRef(id);
    setMentionOpen(false);
    setMentionQuery("");
    requestAnimationFrame(() => ta?.focus());
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @ 引用下拉打开时：Esc 关闭，Enter 选中第一个候选
    if (mentionOpen) {
      if (e.key === "Escape") {
        setMentionOpen(false);
      } else if (e.key === "Enter" && mentionList.length > 0) {
        e.preventDefault();
        selectMention(mentionList[0].id);
      }
      return;
    }
    // 回车发送 / Shift+回车换行；中文输入法组合输入时（isComposing）回车确认候选词，不触发发送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!generating && node.prompt?.trim()) {
        handleGenerate();
      }
    }
  };

  // 卡片比例：有生成图片时用图片真实比例（避免 object-contain 留边、边框/把手不贴合），否则用所选比例
  const ratioParsed = parseRatio(qualityRatio.ratio);
  const cardAspect = node.imageSrc && imgAspect ? imgAspect : (ratioParsed ? ratioParsed.w / ratioParsed.h : 4 / 3);
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

  const handleGenerate = useCallback(() => {
    // 引用图片（@ 提及）参与编辑：本节点已上传图优先作源图，否则取首个引用
    const refImages = selectedRefs.map((r) => r.thumb).filter(Boolean);
    const sourceImage = node.imageSrc || refImages[0];
    const hasImage = !!sourceImage;
    generate({
      nodeId: node.id,
      handler: hasImage ? "image_to_image" : "text_to_image",
      modelId: selectedModelId || "default",
      input: {
        prompt: node.prompt,
        ...(sourceImage ? { sourceImage } : {}),
        ...(refImages.length ? { references: refImages } : {}),
        aspectRatio: qualityRatio.ratio,
        quality: qualityRatio.quality,
        clarity: qualityRatio.clarity,
      },
    });
  }, [generate, node.id, node.prompt, node.imageSrc, qualityRatio, selectedModelId, selectedRefs]);

  // 打开文件选择器
  const openFilePicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  // 上传图片并设为节点图片（之后输入指令即可做图生图编辑）
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await fileApi.upload(file);
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
    }
  }, [node.id, updateNode]);

  // 自动调整 textarea 高度: 最少 3 行，最多 4 行，超出显示滚动条
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const minH = MIN_ROWS * LINE_HEIGHT;
    const maxH = MAX_ROWS * LINE_HEIGHT;
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, minH), maxH)}px`;
  }, [node.prompt, isSelected]);

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
  const showAuxUI = isSelected && !isDragging;

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
        {/* 已生成：顶部操作工具栏（恒定大小，吸附卡片左上方） */}
        {showAuxUI && node.imageSrc && (
          <NodeChrome zoom={zoom} placement="top-left" gap={8}>
          <div
            onMouseDown={stop}
            className="flex items-center gap-0.5 whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-700 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {["全景", "多角度", "打光", "九宫格", "高清", "宫格切分"].map((op) => (
              <button
                key={op}
                onMouseDown={stop}
                onClick={(e) => { stop(e); toast.info(`「${op}」功能即将上线`); }}
                className="rounded-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {op}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
            <button onMouseDown={stop} onClick={openFilePicker} title="重新上传 / 图生图" className="rounded-lg p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button onMouseDown={stop} onClick={(e) => { stop(e); if (node.imageSrc) window.open(node.imageSrc, "_blank"); }} title="下载" className="rounded-lg p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Download className="h-3.5 w-3.5" />
            </button>
            <button onMouseDown={stop} onClick={(e) => { stop(e); if (node.imageSrc) window.open(node.imageSrc, "_blank"); }} title="查看大图" className="rounded-lg p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Maximize2 className="h-3.5 w-3.5" />
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
          {/* 错误状态 */}
          {node.status === "error" && !generating && (
            <div className="absolute right-3 top-3 z-[5] rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              生成失败
            </div>
          )}
          {node.imageSrc ? (
            <img
              src={node.imageSrc}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const t = e.currentTarget;
                if (t.naturalWidth > 0 && t.naturalHeight > 0) setImgAspect(t.naturalWidth / t.naturalHeight);
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
          <div className="relative rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950" style={{ width: node.width + PANEL_EXTRA, boxSizing: "border-box" }}>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button onMouseDown={stop} className="flex flex-col items-center gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                <Box className="h-3.5 w-3.5" />
                <span>风格</span>
              </button>
              <button onMouseDown={stop} className="flex flex-col items-center gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                <MapPin className="h-3.5 w-3.5" />
                <span>标记</span>
              </button>
              {/* 入边连接的可引用图片缩略图：点击即 @ 引用 */}
              {refs.map((ref) => {
                const active = refIds.includes(ref.id);
                return (
                  <button
                    key={ref.id}
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); addRef(ref.id); }}
                    title={`引用 图片${ref.index}`}
                    className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border transition-all duration-150 hover:scale-105 ${active ? "border-blue-500 ring-1 ring-blue-300" : "border-neutral-200 hover:border-blue-400 dark:border-neutral-700"}`}
                  >
                    {ref.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-neutral-100 text-[9px] text-neutral-400 dark:bg-neutral-800">无图</span>
                    )}
                    <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-neutral-900/80 px-1 text-[9px] font-medium text-white">{ref.index}</span>
                  </button>
                );
              })}
            </div>
            <button onMouseDown={stop} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="relative mt-3">
            <div className="flex flex-wrap items-start gap-1">
              {/* 已 @ 引用的图片，作为内联 chip 显示在输入前 */}
              {selectedRefs.map((ref) => (
                <span key={ref.id} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-50 py-0.5 pl-1 pr-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {ref.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ref.thumb} alt="" className="h-4 w-4 rounded-sm object-cover" />
                  ) : null}
                  图片{ref.index}
                  <button onMouseDown={stop} onClick={(e) => { stop(e); removeRef(ref.id); }} className="rounded-sm p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800/40">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <textarea
                ref={textareaRef}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                onKeyDown={handlePromptKeyDown}
                onMouseDown={stop}
                placeholder={selectedRefs.length ? "" : "可直接文字生图，输入 @ 引用已连接图片，或上传图片编辑，如：将背景改为雪夜"}
                rows={MIN_ROWS}
                className="block min-w-[140px] flex-1 resize-none border-0 bg-transparent text-sm leading-5 placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none focus:ring-0"
                style={{
                  cursor: "text",
                  outline: "none",
                  boxShadow: "none",
                  maxHeight: `${MAX_ROWS * LINE_HEIGHT}px`,
                  overflowY: "auto",
                  overflowX: "hidden",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* @ 引用下拉：列出可引用图片，点击插入 chip */}
            {mentionOpen && mentionList.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                {mentionList.map((ref) => (
                  <button
                    key={ref.id}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); selectMention(ref.id); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {ref.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.thumb} alt="" className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-[9px] text-neutral-400 dark:bg-neutral-800">图</span>
                    )}
                    <span className="text-sm text-neutral-700 dark:text-neutral-200">图片{ref.index}</span>
                    <span className="ml-auto text-xs text-neutral-400">@{ref.index}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
              <ModelPicker models={imageModels} value={selectedModelId} onChange={setSelectedModelId} />
              <QualityRatioPicker
                value={qualityRatio}
                onChange={setQualityRatio}
                qualities={formatConfig.qualities}
                clarities={formatConfig.clarities}
                ratios={formatConfig.ratios}
              />
              <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Camera className="h-3 w-3" />
                摄像机
              </button>
              <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                1张
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5 text-xs text-neutral-500">
                <Zap className="h-3 w-3 text-amber-500" fill="currentColor" />
                {pointCost}
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
