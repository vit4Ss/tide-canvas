"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Center, Group, Paper, Stack, Text, TextInput, ThemeIcon, UnstyledButton } from "@mantine/core";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import {
  Image as ImageIcon, Upload, Maximize2, Copy,
  Camera, ArrowUp, ChevronDown, ChevronRight, Zap, Download, X, Minimize2,
  ArrowLeft, LayoutGrid, Layers,
  Images, Orbit, Sun, Table, Brush, FlipHorizontal2,
  Grid2x2, Hash, RotateCcw,
  ScanFace, UserRound, Mountain, Package, Film, Contrast, PersonStanding,
  Smile, Crop, RotateCw, Gem, WandSparkles,
} from "lucide-react";
import { QualityRatioPicker, parseRatio, RATIO_OPTIONS, QUALITY_OPTIONS, CLARITY_OPTIONS, type QualityRatioValue } from "./quality-ratio-picker";
import { BatchCountDropdown } from "./components/batch-count-dropdown";
import { ImageStylePicker, DEFAULT_STYLE_PRESET, type ImageStylePreset } from "./image-style-picker";
import { STYLE_REFERENCE_NODE_TYPE } from "./style-reference-node";
import { ModelPicker } from "./model-picker";
import { PromptRefEditor, PromptEditorModal } from "./prompt-ref-editor";
import { PanoramaViewer } from "./panorama-viewer";
import { InlinePanorama, type InlinePanoramaApi } from "./inline-panorama";
import { type RefItem } from "./prompt-ref-utils";
import { NodeChrome } from "./base/node-chrome";
import { NodePorts } from "./base/node-ports";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { resolveModelReferenceCountLimit, resolveModelReferenceLimitBytes } from "@/lib/upload-limits";
import { sliceImageGrid, transformImageRaster, type RasterTransform } from "@/lib/image-slice";
import { disableOssDisplayProcessing, fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";
import { matrixPrice, keyVariants } from "@/lib/price-matrix";
import { getImageCardSizeForRatio } from "@/lib/image-card-size";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE, isConceptCanvasNodeType, isPanoramaCanvasNode, isVisualReferenceNodeType } from "@/lib/canvas-node-types";
import { AiModelType } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import { Loader2 } from "lucide-react";
import type { CanvasNodeProps } from "./types/node-props";
import { useAiModels, useMediaErrorRecovery, useNodePrompt, useNodeRuntime, useSyncContentSize } from "./shared/use-node-runtime";
import { useMediaUpload } from "./shared/use-media-upload";
import { useFileDownload } from "./shared/use-file-download";
import { ConfigurableNodeToolbar, type ConfigurableNodeToolbarAction } from "./shared/configurable-node-toolbar";
import {
  PortraitFeaturePanel,
  preloadExpressionPreviewSprite,
  preloadMakeupPresetSprites,
  type PortraitFeatureGenerateRequest,
  type PortraitFeaturePanelMode,
} from "./shared/portrait-feature-panel";
import { useCanvasNodeFeatures } from "@/stores/use-canvas-node-config-store";
import { findRightColumnSpot, getIncomingSources, inlineIncomingTextRefs, parseModelConfig, stopEvent as stop, validateReferenceFileSizes } from "./shared/node-utils";
import { NodeDimsBadge, NodeErrorBadge, NodeGeneratingOverlay, NodeMediaLightbox, NodeShell, NodeUploadingOverlay } from "./shared/node-overlays";
import { buildImageDerivativeMetadata, imageDerivativeTitle } from "./image-node-derivation";

// 自定义宫格选择器的最大行列（N×N 网格）
const CUSTOM_MAX = 8;
function fitCardSize(aspect: number, ratio?: string | null) {
  return getImageCardSizeForRatio(ratio, aspect);
}

/** 是否为比例选择器里存在的明确比例（排除 auto/空值），用于比例继承判断 */
function isStandardRatio(r?: string | null): r is string {
  return !!r && r !== "auto" && RATIO_OPTIONS.some((o) => o.value === r);
}

// 提示词面板比图片卡片左右各宽出的总量（仅未生成图片时显示），居中伸出让底部控件更宽松
const PANEL_EXTRA = 80;
const STYLE_REFERENCE_WIDTH = 320;
const STYLE_REFERENCE_HEIGHT = 356;
const STYLE_REFERENCE_GAP = 92;
const DEFAULT_BATCH_OPTIONS: number[] = [1, 2, 4];
const DEFAULT_QUALITY_VALUES: string[] = QUALITY_OPTIONS.map((quality) => quality.value);
const DEFAULT_CLARITY_VALUES: string[] = [...CLARITY_OPTIONS];

function getStyleReferenceTitle(preset: ImageStylePreset): string {
  return `素材-风格-${preset.shortName || preset.name || "未命名风格"}`;
}

function getStyleReferencePatch(preset: ImageStylePreset): Partial<CanvasNode> {
  const displayName = preset.shortName || preset.name;
  const coverUrl = preset.coverUrl || "";
  return {
    type: STYLE_REFERENCE_NODE_TYPE,
    title: getStyleReferenceTitle(preset),
    width: STYLE_REFERENCE_WIDTH,
    height: STYLE_REFERENCE_HEIGHT,
    contentW: STYLE_REFERENCE_WIDTH,
    contentH: STYLE_REFERENCE_HEIGHT,
    status: "success",
    imageSrc: coverUrl || undefined,
    stylePresetId: preset.id,
    stylePresetName: displayName,
    stylePresetPrompt: preset.prompt,
    stylePresetModelIds: preset.modelIds,
    stylePresetModelPrompts: preset.modelPrompts,
    stylePresetCoverUrl: coverUrl || undefined,
  };
}

function getStylePromptForModel(prompt: string, modelPrompts?: Record<string, string>, modelId?: string): string {
  const modelPrompt = modelId ? modelPrompts?.[modelId]?.trim() : "";
  return modelPrompt || prompt || "";
}

// 全景扩图提示词：让模型把当前图扩展为可环绕的 360° 全景（比例跟随源图节点）
function EditableImageNodeTitle({ node }: { node: CanvasNode }) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const presentation = node.type === CHARACTER_NODE_TYPE
    ? { fallbackTitle: "角色节点", renameTitle: "双击重命名角色节点", Icon: UserRound }
    : node.type === SCENE_NODE_TYPE
      ? { fallbackTitle: "场景节点", renameTitle: "双击重命名场景节点", Icon: Mountain }
      : { fallbackTitle: "图片节点", renameTitle: "双击重命名图片节点", Icon: ImageIcon };
  const currentTitle = node.title?.trim() || presentation.fallbackTitle;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentTitle);

  const startEdit = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setDraft(currentTitle);
    setEditing(true);
  }, [currentTitle]);

  const commit = useCallback(() => {
    const nextTitle = draft.trim() || presentation.fallbackTitle;
    if (nextTitle !== node.title) {
      updateNode(node.id, { title: nextTitle }, true);
    }
    setEditing(false);
  }, [draft, node.id, node.title, presentation.fallbackTitle, updateNode]);

  const cancel = useCallback(() => {
    setDraft(currentTitle);
    setEditing(false);
  }, [currentTitle]);

  if (editing) {
    return (
      <Group gap={4} wrap="nowrap" px={4} c="dimmed">
        <presentation.Icon className="h-3.5 w-3.5 shrink-0" />
        <TextInput
          autoFocus
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          size="xs"
          variant="unstyled"
          styles={{
            root: { width: 176 },
            input: {
              minHeight: 22,
              height: 22,
              paddingInline: 6,
              border: "1px solid var(--mantine-color-gray-4)",
              borderRadius: 5,
              background: "var(--mantine-color-white)",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: "20px",
            },
          }}
        />
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" px={4} c="dimmed">
      <presentation.Icon className="h-3.5 w-3.5 shrink-0" />
      <UnstyledButton
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={startEdit}
        title={presentation.renameTitle}
        px={4}
        py={2}
        style={{ maxWidth: 180, borderRadius: 5 }}
      >
        <Text size="12px" fw={500} truncate c="dimmed">
          {currentTitle}
        </Text>
      </UnstyledButton>
    </Group>
  );
}
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

// ===== 打光：光源方向 + 色温/强度 + 预设方案，组重打光提示词走图生图 =====
const LIGHT_DIRECTIONS = [
  { value: "left", label: "左侧", text: "主光从画面左侧打来，右侧留出自然阴影" },
  { value: "front", label: "正面", text: "主光从正面均匀照亮主体" },
  { value: "right", label: "右侧", text: "主光从画面右侧打来，左侧留出自然阴影" },
  { value: "top", label: "顶光", text: "主光从上方打下，形成顶光" },
  { value: "back", label: "逆光", text: "光源位于主体后方，形成逆光轮廓" },
];
const LIGHT_DEFAULT = { direction: "front", temp: 0, intensity: 0 };
const LIGHT_PRESETS = [
  { label: "自定义", ...LIGHT_DEFAULT, desc: "" },
  { label: "黄金时刻", direction: "left", temp: 35, intensity: 10, desc: "傍晚黄金时刻的低角度阳光，暖金色调，拉出细长柔和的影子" },
  { label: "窗边柔光", direction: "left", temp: 10, intensity: -25, desc: "大窗漫射进来的柔和自然光，明暗过渡细腻通透" },
  { label: "摄影棚", direction: "front", temp: 0, intensity: 15, desc: "专业摄影棚三点布光，主体受光均匀，背景干净" },
  { label: "霓虹夜景", direction: "right", temp: -35, intensity: 20, desc: "夜晚霓虹灯氛围，冷暖对比的城市夜色光效" },
  { label: "剪影逆光", direction: "back", temp: 10, intensity: 35, desc: "强烈逆光勾出主体轮廓光，主体偏暗接近剪影" },
];

// ===== 九宫格：预设生成模式（多机位/分镜/设定图等），以源图为参考走图生图，
// 一条工程化提示词产出一张排版好的宫格/设定图。ratio 缺省沿用源图画幅
//（N×N 等比宫格整图画幅 = 单格画幅）；三视图/设定图类固定横幅排版。=====
const GRID_GEN_PRESETS: { label: string; icon: typeof LayoutGrid; ratio?: string; prompt: string }[] = [
  {
    label: "多机位九宫格",
    icon: LayoutGrid,
    prompt:
      "将参考图的主体生成一张 3×3 九宫格图片：九个格子是同一主体、同一场景在九个不同机位与景别下的画面——" +
      "特写、近景、中景、全景、低角度仰拍、高角度俯拍、正侧面、背面、四分之三侧。" +
      "必须保持主体身份、服饰/材质、色调、光照与画风完全一致；格子之间用细分隔线整齐排布，每格构图完整独立。",
  },
  {
    label: "剧情推演四宫格",
    icon: Grid2x2,
    prompt:
      "以参考图为第一格起点，生成一张 2×2 四宫格连续剧情分镜：四个画面按时间顺序自然推进一段合理的短剧情，" +
      "镜头与动作前后衔接流畅。保持主体身份与画风一致，光照与场景连贯；格子间用细分隔线排布，阅读顺序从左到右、从上到下。",
  },
  {
    label: "角色脸部三视图",
    icon: ScanFace,
    ratio: "16:9",
    prompt:
      "生成参考图角色脸部的三视图，在一张图中从左到右横向排列：正面、四分之三侧面、正侧面。" +
      "三个头像的五官、发型、肤色、神态严格一致，比例统一、视线水平；干净纯色浅背景，角色设定图排版风格，画风与参考图一致。",
  },
  {
    label: "角色设定图",
    icon: UserRound,
    ratio: "16:9",
    prompt:
      "把参考图角色生成一张完整的角色设定图（character sheet）：包含全身正面、侧面、背面三视图，" +
      "头部特写，2~3 个表情小图，以及服饰/道具细节放大。白底设定图排版，标注区留白干净，" +
      "所有视图的身份、体型比例、服饰细节与配色严格一致，画风与参考图一致。",
  },
  {
    label: "场景设定图",
    icon: Mountain,
    ratio: "16:9",
    prompt:
      "基于参考图生成一张场景美术设定图：主视角大图为核心，周围排布同一场景的不同视角小图与关键道具/结构的细节放大图，" +
      "可附白天与夜晚两种光照的小图对比。概念设定图排版，构造与风格与参考图严格一致，整体干净专业。",
  },
  {
    label: "产品设定图",
    icon: Package,
    ratio: "16:9",
    prompt:
      "把参考图中的产品生成一张商业产品设定图：包含正面、侧面、背面、俯视多角度视图，外加材质与细节特写放大图，" +
      "干净浅色背景、柔和摄影棚光。产品的造型、材质、配色与参考图严格一致，商业渲染排版风格。",
  },
  {
    label: "25宫格连贯分镜",
    icon: Film,
    prompt:
      "以参考图为起点生成一张 5×5 二十五宫格连贯分镜：二十五个画面是同一主体的连续镜头序列，" +
      "按从左到右、从上到下的顺序推进剧情，景别与机位有节奏地变化（远近交替、角度变化）。" +
      "主体身份与画风全程一致，光照与场景连贯；格子间用细分隔线整齐排布。",
  },
  {
    label: "电影级光影校正",
    icon: Contrast,
    prompt:
      "对参考图进行电影级调色与光影校正：优化曝光与对比度、平衡色彩、增加自然的高光层次与柔和阴影，" +
      "赋予电影胶片质感的色调与氛围。严格保持画面内容、主体与构图不变，只提升光影与色彩品质。",
  },
];

const SUBJECT_TURNAROUND_PROMPT = [
  "基于参考图中的核心主体生成一张专业三视图设定图，在同一张图中从左到右横向排列：正面、正侧面、背面。",
  "如果主体是人物，必须使用全身视图，三个视图身高比例与脚底基线严格对齐，身份、体型、五官、发型、服饰、饰品、配色和材质细节完全一致；如果主体是产品或物体，则保持结构、尺度、材质与标识细节一致。",
  "使用干净纯色浅背景和标准正交设定图排版，只改变观察方向，不增加文字、水印、额外人物或无关物体。",
].join(" ");

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

const CROP_OPTIONS: { ratio: string; aspect: number; name: string }[] = [
  { ratio: "1:1", aspect: 1, name: "正方形" },
  { ratio: "3:4", aspect: 3 / 4, name: "竖版人像" },
  { ratio: "4:3", aspect: 4 / 3, name: "横版画幅" },
  { ratio: "9:16", aspect: 9 / 16, name: "手机竖屏" },
  { ratio: "16:9", aspect: 16 / 9, name: "宽屏画幅" },
];

const ROTATE_OPTIONS: { label: string; degrees: -90 | 90 | 180 }[] = [
  { label: "向左旋转 90°", degrees: -90 },
  { label: "向右旋转 90°", degrees: 90 },
  { label: "旋转 180°", degrees: 180 },
];

const TOOLBAR_MENU_SURFACE = "animate-in fade-in-0 zoom-in-95 rounded-2xl border border-neutral-200/80 bg-white/95 p-1.5 text-neutral-800 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl duration-100 motion-reduce:animate-none dark:border-white/10 dark:bg-neutral-900/95 dark:text-neutral-100 dark:shadow-black/55";
const TOOLBAR_MENU_ITEM = "group flex w-full items-center rounded-xl text-left transition-colors duration-150 hover:bg-neutral-100/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35 motion-reduce:transition-none dark:hover:bg-white/[0.07]";

function RatioPreview({ aspect }: { aspect: number }) {
  const width = aspect >= 1 ? 22 : Math.max(8, Math.round(22 * aspect));
  const height = aspect >= 1 ? Math.max(8, Math.round(22 / aspect)) : 22;
  return (
    <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-[10px] bg-neutral-100/90 ring-1 ring-inset ring-neutral-200/60 dark:bg-white/[0.06] dark:ring-white/10" aria-hidden>
      <span
        className="rounded-[3px] border border-neutral-400/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:border-neutral-500 dark:bg-neutral-800"
        style={{ width, height }}
      />
    </span>
  );
}

function GridPreview({ size }: { size: number }) {
  return (
    <span
      className="grid h-8 w-9 shrink-0 gap-[2px] rounded-[10px] bg-neutral-100/90 p-2 ring-1 ring-inset ring-neutral-200/60 dark:bg-white/[0.06] dark:ring-white/10"
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {Array.from({ length: size * size }, (_, index) => (
        <span key={index} className="min-h-0 min-w-0 rounded-[1px] bg-neutral-400/75 dark:bg-neutral-500" />
      ))}
    </span>
  );
}

function resolvePresetRatio(preferred: readonly string[], configured?: readonly string[]) {
  if (!configured?.length) return preferred[0];
  return preferred.find((ratio) => configured.includes(ratio)) ?? configured[0];
}

const PORTRAIT_PANEL_FEATURES = {
  makeup: "image.makeupAdjust",
  expression: "image.expressionAdjust",
  texture: "image.portraitTexture",
} as const;

type LocalTransformKind = "mirror" | "crop" | "rotate";

function swapRatio(ratio?: string | null): string | undefined {
  if (!ratio) return undefined;
  const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return match ? `${match[2]}:${match[1]}` : undefined;
}

function ImageTransformMenu({
  mode,
  busy,
  onCrop,
  onRotate,
}: {
  mode: "crop" | "rotate";
  busy: boolean;
  onCrop?: (ratio: string, aspect: number) => void;
  onRotate?: (degrees: -90 | 90 | 180) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const isCrop = mode === "crop";
  const Icon = isCrop ? Crop : RotateCw;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const pickCrop = (ratio: string, aspect: number) => {
    close();
    onCrop?.(ratio, aspect);
  };

  const pickRotate = (degrees: -90 | 90 | 180) => {
    close();
    onRotate?.(degrees);
  };

  // 菜单 portal 到 body：打开时按触发器 rect 计算 fixed 定位（脱离画布 transform 层，下方空间不足上翻）
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 192;
    const estHeight = (isCrop ? 5 : 3) * 44 + 42;
    const below = window.innerHeight - rect.bottom;
    const up = below < estHeight && rect.top > below;
    setPos({ left: Math.max(8, rect.right - menuWidth), top: up ? rect.top : rect.bottom, up });
  }, [open, isCrop]);

  // Esc / 外部点击关闭（外部点击关闭时不把焦点拉回触发器）
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={stop}
        onClick={(event) => {
          stop(event);
          setOpen((current) => !current);
        }}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55 ${open ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {isCrop ? "裁剪" : "旋转"}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={isCrop ? "裁剪比例" : "旋转方式"}
              className={`fixed z-[90] w-48 ${TOOLBAR_MENU_SURFACE}`}
              style={{
                left: pos.left,
                ...(pos.up ? { bottom: window.innerHeight - pos.top + 8 } : { top: pos.top + 8 }),
              }}
            >
              <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                <span>{isCrop ? "裁剪比例" : "旋转方式"}</span>
                {isCrop ? <span className="font-normal text-neutral-400 dark:text-neutral-500">居中裁剪</span> : null}
              </div>
              {isCrop
                ? CROP_OPTIONS.map(({ ratio, aspect, name }) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={ratio}
                      onClick={() => pickCrop(ratio, aspect)}
                      className={`${TOOLBAR_MENU_ITEM} h-11 gap-2.5 px-2`}
                    >
                      <RatioPreview aspect={aspect} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-4 text-neutral-800 dark:text-neutral-100">{ratio}</span>
                        <span className="block text-[11px] leading-4 text-neutral-400 dark:text-neutral-500">{name}</span>
                      </span>
                    </button>
                  ))
                : ROTATE_OPTIONS.map(({ label, degrees }) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={degrees}
                      onClick={() => pickRotate(degrees)}
                      className={`${TOOLBAR_MENU_ITEM} h-11 gap-2.5 px-2`}
                    >
                      <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-[10px] bg-neutral-100/90 text-neutral-500 ring-1 ring-inset ring-neutral-200/60 transition-colors group-hover:text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-400 dark:ring-white/10 dark:group-hover:text-neutral-100">
                        {degrees < 0 ? <RotateCcw className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
                      </span>
                      <span className="text-[13px] font-medium">{label}</span>
                    </button>
                  ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// memo 化：仅当自身 props（node / 选中 / 拖拽 / 连接目标）变化时重渲染，
// 画布平移、其他节点拖动都不会触发本节点重渲染。
export const ImageNode = memo(function ImageNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: CanvasNodeProps) {
  const configuredFeatures = useCanvasNodeFeatures(node.type);
  // 角色/场景执行图片能力后仍保留语义类型，后续引用提示词与保存到资产库
  // 才能继续落到角色/场景分类；普通图片的衍生结果仍为 image。
  const derivativeNodeType = isConceptCanvasNodeType(node.type) ? node.type : "image";
  const promptPlaceholder = node.type === CHARACTER_NODE_TYPE
    ? "描述角色的外貌、服装、表情与姿态，或上传参考图保持角色一致性"
    : node.type === SCENE_NODE_TYPE
      ? "描述场景的环境、时间、光线与氛围，或上传参考图继续扩展"
      : "可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜";
  const { generate, isGenerating, generating, showAuxUI } = useNodeRuntime(node, isSelected, isDragging);
  const gridMenuRef = useRef<HTMLDivElement>(null);
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
  const [previewMediaState, setPreviewMediaState] = useState({ src: "", failed: false, retry: 0 });
  // 360° 全景查看器（src 为生成出的全景扩图地址）
  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const [panoramaSrc, setPanoramaSrc] = useState<string | null>(null);
  // 内嵌全景：三分网格开关 + 复位视角（由卡片上方专用工具栏控制）
  const [panoGrid, setPanoGrid] = useState(false);
  const [panoCaptureBusy, setPanoCaptureBusy] = useState<"single" | "grid" | null>(null);
  const panoApiRef = useRef<InlinePanoramaApi | null>(null);
  const [angleOpen, setAngleOpen] = useState(false);
  const [lightOpen, setLightOpen] = useState(false);
  const [portraitPanel, setPortraitPanel] = useState<PortraitFeaturePanelMode | null>(null);
  const activePortraitPanel = portraitPanel && configuredFeatures.includes(PORTRAIT_PANEL_FEATURES[portraitPanel])
    ? portraitPanel
    : null;
  const [hdMenuOpen, setHdMenuOpen] = useState(false);
  const hdMenuRef = useRef<HTMLDivElement>(null);
  const [gridGenMenuOpen, setGridGenMenuOpen] = useState(false);
  const gridGenMenuRef = useRef<HTMLDivElement>(null);
  const directPortraitActionAtRef = useRef(0);
  const [lightPreset, setLightPreset] = useState("自定义");
  const [lightDirection, setLightDirection] = useState(LIGHT_DEFAULT.direction);
  const [lightTemp, setLightTemp] = useState(LIGHT_DEFAULT.temp);
  const [lightIntensity, setLightIntensity] = useState(LIGHT_DEFAULT.intensity);
  const [anglePreset, setAnglePreset] = useState("自定义");
  const [angleYaw, setAngleYaw] = useState(MULTI_ANGLE_DEFAULT.yaw);
  const [anglePitch, setAnglePitch] = useState(MULTI_ANGLE_DEFAULT.pitch);
  const [angleZoom, setAngleZoom] = useState(MULTI_ANGLE_DEFAULT.zoom);
  const [wideLens, setWideLens] = useState(MULTI_ANGLE_DEFAULT.wideLens);
  const angleDragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [angleDragging, setAngleDragging] = useState(false);
  // 卡片展示图:OSS 原图(常为 2K~4K)降采样到 2048 宽。几十张原图同屏参与
  // GPU 合成是画布掉帧大头;全屏查看/下载/生成参考仍用原始 node.imageSrc。
  const cardDisplaySrc = ossDisplayUrl(node.imageSrc, 2048);
  const [cardMediaState, setCardMediaState] = useState({ src: "", useOriginal: false, failed: false, retry: 0 });
  const currentImageSrc = node.imageSrc ?? "";
  const currentCardMedia = cardMediaState.src === currentImageSrc
    ? cardMediaState
    : { src: currentImageSrc, useOriginal: false, failed: false, retry: 0 };
  const currentPreviewMedia = previewMediaState.src === currentImageSrc
    ? previewMediaState
    : { src: currentImageSrc, failed: false, retry: 0 };
  const activeCardImageSrc = currentCardMedia.useOriginal ? node.imageSrc : cardDisplaySrc;
  const [handlerCosts, setHandlerCosts] = useState<Record<string, number>>({});
  const { models: imageModels, modelId: selectedModelId, setModelId: setSelectedModelId, selectedModel } = useAiModels(
    AiModelType.IMAGE,
    node.generationConfig?.modelId,
  );
  const formatConfig = useMemo(
    () => parseModelConfig<{ qualities?: string[]; clarities?: string[]; resolutions?: string[]; ratios?: string[]; batchSizes?: number[]; gridOutput?: boolean; maxRefImages?: number; pricing?: Record<string, Record<string, number>> }>(selectedModel),
    [selectedModel],
  );
  // A model may remove an option that the previous model allowed. Derive a
  // valid selection immediately during render instead of mutating state in an
  // effect (which caused one stale request/render after every model switch).
  const batchOptions = formatConfig.batchSizes?.length ? formatConfig.batchSizes : DEFAULT_BATCH_OPTIONS;
  const qualityValues = formatConfig.qualities ?? DEFAULT_QUALITY_VALUES;
  const clarityValues = formatConfig.clarities ?? formatConfig.resolutions ?? DEFAULT_CLARITY_VALUES;
  const ratioValues = formatConfig.ratios;
  const hasRatioDim = !ratioValues || ratioValues.length > 0;
  const {
    fileInputRef,
    openFilePicker,
    handleFileUpload: handleFileChange,
    nodeUploading,
    nodeUploadPct,
    uploadPreviewSrc,
    dims: imageDims,
    setDims: setImageDims,
    mountedRef,
  } = useMediaUpload(node, "image", selectedModel);
  const { downloading, download: handleDownload } = useFileDownload();
  const { promptExpanded, setPromptExpanded, handlePromptChange } = useNodePrompt(node, node.imageSrc);
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
  const [ratioTouched, setRatioTouched] = useState(false);
  const [qualityRatioState, setQualityRatio] = useState<QualityRatioValue>({
    quality: node.generationConfig?.quality ?? "standard",
    clarity: node.generationConfig?.resolution ?? "2K",
    ratio: defaultRatio ?? "16:9",
  });
  // 默认比例变化（如事后连入全景图）且用户未手动改过 → 渲染期同步跟随（官方「props 变化调整 state」模式）
  const [lastDefaultRatio, setLastDefaultRatio] = useState(defaultRatio);
  if (defaultRatio !== lastDefaultRatio) {
    setLastDefaultRatio(defaultRatio);
    if (defaultRatio && !ratioTouched) {
      setQualityRatio((s) => ({ ...s, ratio: defaultRatio }));
    }
  }
  const qualityRatio = useMemo<QualityRatioValue>(() => {
    const normalizedClarity = clarityValues.length && !clarityValues.includes(qualityRatioState.clarity)
      ? clarityValues.find((value) => value.toLowerCase() === qualityRatioState.clarity.toLowerCase()) ?? clarityValues[0]
      : qualityRatioState.clarity;
    return {
      quality: qualityValues.length && !qualityValues.includes(qualityRatioState.quality)
        ? qualityValues[0] as QualityRatioValue["quality"]
        : qualityRatioState.quality,
      clarity: normalizedClarity as QualityRatioValue["clarity"],
      ratio: ratioValues?.length && !ratioValues.includes(qualityRatioState.ratio)
        ? ratioValues[0]
        : qualityRatioState.ratio,
    };
  }, [clarityValues, qualityRatioState, qualityValues, ratioValues]);
  // 一次出图张数（批量）：全部存入本节点 images，组图交互展示
  const [batchCountState, setBatchCount] = useState(node.generationConfig?.batchCount ?? 1);
  const batchCount = batchOptions.includes(batchCountState) ? batchCountState : batchOptions[0];
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
    // panoramaSig is the narrow Zustand subscription that invalidates this
    // non-reactive getState lookup only when an attached panorama changes.
    void panoramaSig;
    const st = useCanvasStore.getState();
    const conn = st.connections.find((c) => {
      if (c.sourceId !== node.id) return false;
      const target = st.nodes.find((n) => n.id === c.targetId);
      return isPanoramaCanvasNode(target);
    });
    return conn ? st.nodes.find((n) => n.id === conn.targetId) : undefined;
  }, [node.id, panoramaSig]);
  const panoramaGenerating = existingPanorama ? isGenerating(existingPanorama.id) || existingPanorama.status === "generating" : false;

  useMediaErrorRecovery(node, node.imageSrc, generating);

  // ===== 引用（@ 提及）系统 =====
  // 取入边连接对应的源节点图片，编号 图片1/图片2…。用字符串签名做选择器，
  // 仅在引用真正变化时重渲染，避免拖动其它节点触发本节点重渲染。
  const refsSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => {
        const src = s.nodes.find((n) => n.id === c.sourceId);
        // 风格引用节点不参与参考图:其 imageSrc 是风格封面,混入会把文生图
        // 静默变成「对着封面做图生图」,还挤乱「图片N」编号
        if (!src) return "";
        if (src.type === "text") return src.content ? "t~" + src.id + "~" + src.content + "~" + (src.title || "") : "";
        if (!isVisualReferenceNodeType(src.type)) return "";
        return src.id + "~" + (src.imageSrc || src.videoSrc || "") + "~" + (src.title || "");
      })
      .filter(Boolean)
      .join("|")
  );
  const refs = useMemo<RefItem[]>(() => {
    const st = useCanvasStore.getState();
    const out: RefItem[] = [];
    // 文本另立一套「文本N」编号：它不占 image_urls 的位置（正文直接拼进 prompt），
    // 混进 out 会把后面每张参考图的序号顶偏一位。
    const texts: RefItem[] = [];
    // 有自有底图时，本节点图占「图片1」（待编辑主图），入边引用图从「图片2」起编号，
    // 与后端 image_urls = [主图, ...参考图] 的下发顺序严格对齐。
    const base = node.imageSrc ? 1 : 0;
    for (const c of st.connections) {
      if (c.targetId !== node.id) continue;
      const src = st.nodes.find((n) => n.id === c.sourceId);
      if (!src) continue;
      if (src.type === "text") {
        if (src.content?.trim()) texts.push({ id: src.id, thumb: "", title: src.title || "", index: texts.length + 1, kind: "text", text: src.content });
        continue;
      }
      if (!isVisualReferenceNodeType(src.type)) continue;
      // 连了但还没出图的空节点不占号：imageList 由 refs 的 src filter(Boolean) 而来，
      // 给它编号会让其后每张参考图的「图片N」比模型实际收到的位次大一位。
      // 视频节点一直是这么跳的，这里对齐。
      if (!src.imageSrc && !src.videoSrc) continue;
      // 入边视频在这里仍编成「图片N」（imageList 确实按这个位次下发），但渲染要按视频走：
      // thumb 只放真图片，视频 URL 塞进 <img> 是一个坏图图标。
      out.push({
        id: src.id,
        thumb: src.imageSrc || "",
        title: src.title || "",
        index: base + out.length + 1,
        media: src.imageSrc ? "image" : "video",
        src: src.imageSrc || src.videoSrc || "",
      });
    }
    // 图片在前：handleGenerate 的 imageList 直接取 refs 的 src 顺序，文本没有 src 会被滤掉
    return [...out, ...texts];
    // refsSig 作为相等触发器：仅当引用签名变化时才重建（body 内用 getState 非响应式读取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsSig, node.id, node.imageSrc]);
  const hasConceptPrompt = useCanvasStore((s) =>
    s.connections.some((c) => {
      if (c.targetId !== node.id) return false;
      const src = s.nodes.find((n) => n.id === c.sourceId);
      return !!src && isConceptCanvasNodeType(src.type) && !!src.prompt?.trim();
    })
  );
  // 入边文本、角色或场景设定会拼进 prompt，所以输入框空着照样有提示词可发。
  const hasPromptSource = !!node.prompt?.trim() || refs.some((r) => r.kind === "text") || hasConceptPrompt;

  // 卡片比例：生成结果优先沿用本次选择的目标画幅，避免返回图自然尺寸把 16:9 卡片改成竖图。
  const explicitRatio = node.aspectRatio || (!node.imageSrc ? qualityRatio.ratio : null);
  const ratioParsed = explicitRatio ? parseRatio(explicitRatio) : null;
  const cardAspect = ratioParsed ? ratioParsed.w / ratioParsed.h : (node.imageSrc && imgAspect ? imgAspect : 1);
  const { w: cardW, h: cardH } = node.storyboardFrame
    ? { w: 280, h: Math.max(120, Math.round(280 / cardAspect)) }
    : fitCardSize(cardAspect, explicitRatio);
  const promptPanelW = Math.max(640, cardW + PANEL_EXTRA);
  const linkedStyleSig = useCanvasStore((s) =>
    s.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => {
        const src = s.nodes.find((n) => n.id === c.sourceId);
        return src?.type === STYLE_REFERENCE_NODE_TYPE
          ? [src.id, src.stylePresetId || "", src.stylePresetName || "", src.stylePresetPrompt || "", src.stylePresetModelIds?.join(",") || "", JSON.stringify(src.stylePresetModelPrompts || {}), src.stylePresetCoverUrl || ""].join("~")
          : "";
      })
      .filter(Boolean)
      .join("|")
  );
  const linkedStyle = useMemo(() => {
    // linkedStyleSig deliberately drives this getState-backed projection.
    void linkedStyleSig;
    const st = useCanvasStore.getState();
    for (const connection of st.connections) {
      if (connection.targetId !== node.id) continue;
      const source = st.nodes.find((item) => item.id === connection.sourceId);
      if (source?.type === STYLE_REFERENCE_NODE_TYPE && source.stylePresetId) {
        return {
          id: source.stylePresetId,
          name: source.stylePresetName || source.title,
          prompt: getStylePromptForModel(source.stylePresetPrompt || "", source.stylePresetModelPrompts, selectedModelId),
        };
      }
    }
    return null;
  }, [linkedStyleSig, node.id, selectedModelId]);
  const selectedStyleId = linkedStyle?.id ?? DEFAULT_STYLE_PRESET.id;
  const selectedStyleName = linkedStyle?.name ?? DEFAULT_STYLE_PRESET.shortName;
  const selectedStylePrompt = linkedStyle?.prompt ?? "";

  const handleStylePresetChange = useCallback((preset: ImageStylePreset) => {
    const st = useCanvasStore.getState();
    const incomingStyleRefs = st.connections
      .filter((connection) => connection.targetId === node.id)
      .map((connection) => ({
        connection,
        source: st.nodes.find((item) => item.id === connection.sourceId),
      }))
      .filter((entry): entry is { connection: { id: string; sourceId: string; targetId: string }; source: CanvasNode } => entry.source?.type === STYLE_REFERENCE_NODE_TYPE);

    st.pushHistory();
    st.updateNode(node.id, {
      stylePresetId: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : preset.id,
      stylePresetName: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : (preset.shortName || preset.name),
      stylePresetPrompt: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : preset.prompt,
      stylePresetModelIds: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : preset.modelIds,
      stylePresetModelPrompts: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : preset.modelPrompts,
      stylePresetCoverUrl: preset.id === DEFAULT_STYLE_PRESET.id ? undefined : preset.coverUrl,
    }, false);

    if (preset.id === DEFAULT_STYLE_PRESET.id) {
      incomingStyleRefs.forEach((entry) => st.removeNode(entry.source.id, false));
      return;
    }

    const [primaryRef, ...duplicateRefs] = incomingStyleRefs;
    const patch = getStyleReferencePatch(preset);
    if (primaryRef) {
      st.updateNode(primaryRef.source.id, patch, false);
      duplicateRefs.forEach((entry) => st.removeNode(entry.source.id, false));
      return;
    }

    const styleNodeId = generateNodeId();
    const styleNode: CanvasNode = {
      id: styleNodeId,
      x: node.x - STYLE_REFERENCE_WIDTH - STYLE_REFERENCE_GAP,
      y: node.y,
      type: STYLE_REFERENCE_NODE_TYPE,
      title: getStyleReferenceTitle(preset),
      width: STYLE_REFERENCE_WIDTH,
      height: STYLE_REFERENCE_HEIGHT,
      ...patch,
    };
    st.addNode(styleNode, false);
    st.addConnection({ id: `conn_${styleNodeId}_${node.id}`, sourceId: styleNodeId, targetId: node.id }, false);
  }, [node.id, node.x, node.y]);
  // 积分消耗：优先按「画质×清晰度」矩阵价，其次模型固定价，其次 Handler 配置，最后兜底 18。
  // 查表走与服务端 resolveCost 同口径的大小写/轴序容错（matrixPrice），
  // 否则内置清晰度 "2K" 大写遇到后台小写矩阵键会显示模型价、实扣矩阵价。
  // 模型不配画质档位时请求不带 quality（见 handleGenerate），服务端按 default
  // 行扣费——展示查同一行，否则显示固定价、实扣矩阵价。memo 保持数组引用稳定，
  // 不击穿下方 portraitPointCost 的 useCallback。
  const qualityKeys = useMemo(
    () => (qualityValues.length ? keyVariants(qualityRatio.quality) : ["default"]),
    [qualityValues, qualityRatio.quality],
  );
  const matrixCost = matrixPrice(formatConfig.pricing, qualityKeys, keyVariants(qualityRatio.clarity));
  const pointCost = matrixCost ?? selectedModel?.pointCost ?? handlerCosts[node.imageSrc ? "image_to_image" : "text_to_image"] ?? 18;

  // 把卡片实际渲染尺寸同步到 store，供连线层将端点锚定到卡片真实边缘中点（默认对节点居中）。
  useSyncContentSize(node, cardW, cardH);

  const handleGenerate = useCallback(() => {
    const st = useCanvasStore.getState();
    const incomingSources = getIncomingSources(st, node.id);
    const referenceNodes = [
      ...(node.imageSrc || node.videoSrc ? [node] : []),
      ...incomingSources.filter((n) => n.type !== STYLE_REFERENCE_NODE_TYPE && !!(n.imageSrc || n.videoSrc)),
    ];
    if (!validateReferenceFileSizes(referenceNodes, selectedModel)) return;
    // 引用图片参与编辑：按画布连接顺序完整下发 imageList，保证 prompt 里的「图片N / {{Image N}}」
    // 对齐到第 N 张输入图；若本节点已有图，则它固定作为 Image 1。
    const refImages = refs.map((r) => r.src || "").filter(Boolean);
    const ownImage = node.imageSrc || "";
    const imageList = ownImage ? [ownImage, ...refImages] : refImages;
    const hasImage = imageList.length > 0;
    // 数量以后台模型配置为准。maxRefImages 限的是 imageList 总长（本节点图 + 入边参考），
    // 与 allowReferenceUpload 的「< 2 就不给加参考图」同一口径；入边连接数此前不受限，
    // 超了只能等上游报错。服务端 validateReferenceCountInput 是同源兜底。
    const imageLimit = resolveModelReferenceCountLimit(selectedModel, "image", "image_to_image");
    if (hasImage && imageLimit && imageList.length > imageLimit) {
      toast.error(`${selectedModel?.name ?? "所选模型"}最多支持 ${imageLimit} 张输入图片，当前为 ${imageList.length} 张`);
      return;
    }
    const stylePrompt = selectedStylePrompt.trim();
    // 文本节点没有独立下发通道，正文只能落进 prompt——顺序与 refs 的「文本N」编号同源
    const promptWithText = inlineIncomingTextRefs(node.prompt || "", incomingSources);
    const mergedPrompt = [promptWithText.trim(), stylePrompt ? `风格要求：${stylePrompt}` : ""].filter(Boolean).join("\n");
    generate({
      nodeId: node.id,
      handler: hasImage ? "image_to_image" : "text_to_image",
      modelId: selectedModelId || "default",
      gridOutput: formatConfig.gridOutput,
      input: {
        prompt: mergedPrompt,
        ...(stylePrompt ? { stylePreset: selectedStyleId, stylePrompt } : {}),
        ...(imageList.length ? { imageList, sourceImage: imageList[0], references: imageList.slice(1) } : {}),
        // 模型无某维度(后台全不勾)时该参数不下发，避免上游收到其不支持的字段
        ...(hasRatioDim ? { aspectRatio: qualityRatio.ratio, aspect_ratio: qualityRatio.ratio, ratio: qualityRatio.ratio } : {}),
        ...(qualityValues.length ? { quality: qualityRatio.quality } : {}),
        ...(clarityValues.length ? { clarity: qualityRatio.clarity, resolution: qualityRatio.clarity } : {}),
        ...(batchCount > 1 ? { batchCount } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate, node, qualityRatio, selectedModelId, selectedModel, refs, batchCount, selectedStyleId, selectedStylePrompt]);

  // 全景：先 AI 生成 360° 全景扩图（新建图片节点并连线），完成后自动打开 360 查看器。
  // 比例跟随源图节点：源图钉死比例 → 当前面板选的比例 → 16:9 托底（16:9 源出 16:9、9:16 源出 9:16）。
  const generatePanorama = useCallback((reuse?: CanvasNode) => {
    if (!node.imageSrc) { toast.error("请先生成或上传图片"); return; }
    const st = useCanvasStore.getState();
    const panoRatio = (reuse && isStandardRatio(reuse.aspectRatio) ? reuse.aspectRatio : null)
      ?? (isStandardRatio(node.aspectRatio) ? node.aspectRatio : null)
      ?? (isStandardRatio(qualityRatio.ratio) ? qualityRatio.ratio : null)
      ?? "16:9";
    let nid: string;
    if (reuse) {
      // 上次生成失败的全景子节点:复用重试,不再新建——否则失败几次画布上就堆几个空节点
      nid = reuse.id;
      st.selectNode(nid);
    } else {
      nid = generateNodeId();
      const pr = parseRatio(panoRatio);
      const panoAspect = pr ? pr.w / pr.h : 16 / 9;
      // 卡片尺寸与图片节点渲染规则一致：横图限宽、竖图限高
      const { w: cw, h: ph } = fitCardSize(panoAspect, panoRatio);
      // 放到右侧列下方，避免与已有节点堆叠
      const { x: targetX, y: targetY } = findRightColumnSpot(st.nodes, node, cardW, cw);
      st.addNode({
        id: nid,
        type: derivativeNodeType,
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
    }
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
  }, [cardW, derivativeNodeType, generate, node, qualityRatio, selectedModelId]);

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
    // 走到这里若仍有全景子节点,说明上次生成失败(无结果也不在生成中)→ 复用重试
    generatePanorama(existingPanorama ?? undefined);
  }, [existingPanorama, generatePanorama, node.imageSrc, node.is360, panoramaGenerating]);

  // 全景「当前视角截图」→ 上传 → 右侧生成一个连线图片节点
  const handlePanoCapture = useCallback(async () => {
    if (panoCaptureBusy) return;
    setPanoCaptureBusy("single");
    try {
      const dataUrl = panoApiRef.current?.capture();
      if (!dataUrl) { toast.error("截图失败，请重试"); return; }
      const blob = await (await fetch(dataUrl)).blob();
      const res = await uploadFileSmart(new File([blob], "全景截图.png", { type: "image/png" }), undefined, { maxBytes: resolveModelReferenceLimitBytes(selectedModel, "image"), label: "参考图" });
      if (!res.success || !res.data) { toast.error(res.message || "截图上传失败"); return; }
      const st = useCanvasStore.getState();
      const capH = Math.round(node.width / 2);
      const nid = generateNodeId();
      st.addNode({ id: nid, type: derivativeNodeType, x: node.x + node.width + 80, y: node.y, width: node.width, height: capH, contentW: node.width, contentH: capH, title: "全景截图", imageSrc: res.data.fileUrl, status: "success", fileSize: res.data.fileSize, fileType: res.data.fileType, mimeType: res.data.mimeType }, true);
      st.addConnection({ id: `conn_${node.id}_${nid}_c`, sourceId: node.id, targetId: nid }, false);
      st.selectNode(nid);
      toast.success("已截取当前视角");
    } catch {
      toast.error("截图失败，请重试");
    } finally {
      setPanoCaptureBusy(null);
    }
  }, [derivativeNodeType, node.id, node.x, node.y, node.width, panoCaptureBusy, selectedModel]);

  // 全景「4 大视角截图」→ 当前/+90/+180/+270 平视各截一张 → 各上传 → 右侧竖排 4 个连线图片节点
  const handlePanoCapture4 = useCallback(async () => {
    if (panoCaptureBusy) return;
    setPanoCaptureBusy("grid");
    try {
      const urls = panoApiRef.current?.capture4();
      if (!urls || urls.length === 0) { toast.error("截图失败，请重试"); return; }
      toast.info("正在截取 4 个视角…");
      const st = useCanvasStore.getState();
      const capH = Math.round(node.width / 2);
      const baseX = node.x + node.width + 80;
      // 2×2 视角网格，整组相对源卡片垂直居中：竖排 4 张会拖出一条重心下坠的长条，
      // 连线也被拉出大跨度；网格更符合「四视角」的阅读预期。
      const gapX = 40;
      const gapY = 40;
      const baseY = node.y + ((node.contentH ?? node.height) - (capH * 2 + gapY)) / 2;
      let ok = 0;
      for (let i = 0; i < urls.length; i++) {
        // 单个视角 fetch/上传失败不应中断整批,也不产生未处理 rejection。
        try {
          const blob = await (await fetch(urls[i])).blob();
          const res = await uploadFileSmart(new File([blob], `全景视角${i + 1}.png`, { type: "image/png" }), undefined, { maxBytes: resolveModelReferenceLimitBytes(selectedModel, "image"), label: "参考图" });
          if (!res.success || !res.data) continue;
          const nid = generateNodeId();
          st.addNode({ id: nid, type: derivativeNodeType, x: baseX + (i % 2) * (node.width + gapX), y: baseY + Math.floor(i / 2) * (capH + gapY), width: node.width, height: capH, contentW: node.width, contentH: capH, title: `全景视角 ${i + 1}`, imageSrc: res.data.fileUrl, status: "success", fileSize: res.data.fileSize, fileType: res.data.fileType, mimeType: res.data.mimeType }, i === 0);
          st.addConnection({ id: `conn_${node.id}_${nid}_${i}`, sourceId: node.id, targetId: nid }, false);
          ok++;
        } catch {
          /* 跳过此视角 */
        }
      }
      if (ok > 0) toast.success(`已截取 ${ok} 个视角`); else toast.error("截图失败");
    } catch {
      toast.error("截图失败，请重试");
    } finally {
      setPanoCaptureBusy(null);
    }
  }, [derivativeNodeType, node.id, node.x, node.y, node.width, node.height, node.contentH, panoCaptureBusy, selectedModel]);

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

  // 多角度/打光/超分/九宫格共用：在源卡片右侧空位生成结果节点并连线，随后走图像
  // 编辑生成。opts.handler 可换成服务端预设能力（如 upscale，提示词由服务端注入，
  // 此处的 prompt 仅作历史记录展示标签）；opts.ratio 覆盖输出画幅（三视图/设定图
  // 等预设需要横幅排版）；opts.outputNodeType 允许一次性产物降为普通图片，
  // opts.input 覆盖默认请求参数。
  const generateEdited = useCallback((title: string, prompt: string, opts?: { handler?: string; ratio?: string; outputNodeType?: CanvasNode["type"]; input?: Record<string, unknown> }) => {
    if (!node.imageSrc) {
      toast.error("请先生成或上传图片");
      return;
    }
    const outRatio = opts?.ratio ?? multiAngleRatio;
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const { x: targetX, y: targetY } = findRightColumnSpot(st.nodes, node, cardW, cardW);
    const outputType = opts?.outputNodeType ?? derivativeNodeType;
    const generationInput = {
      prompt,
      imageList: [node.imageSrc],
      sourceImage: node.imageSrc,
      aspectRatio: outRatio,
      aspect_ratio: outRatio,
      ratio: outRatio,
      quality: qualityRatio.quality,
      clarity: qualityRatio.clarity,
      resolution: qualityRatio.clarity,
      ...opts?.input,
    };

    st.addNode({
      id: nid,
      type: outputType,
      x: targetX,
      y: targetY,
      width: cardW,
      height: cardH,
      contentW: cardW,
      contentH: cardH,
      title,
      status: "idle",
      aspectRatio: outRatio,
      ...buildImageDerivativeMetadata({
        source: node,
        outputType,
        modelId: selectedModelId,
        generationInput,
      }),
    }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
    st.selectNode(nid);
    generate({
      nodeId: nid,
      handler: opts?.handler ?? "image_to_image",
      modelId: selectedModelId || "default",
      input: generationInput,
    });
  }, [cardH, cardW, derivativeNodeType, generate, multiAngleRatio, node, qualityRatio.clarity, qualityRatio.quality, selectedModelId]);

  const togglePortraitPanel = useCallback((mode: PortraitFeaturePanelMode) => {
    if (mode === "expression") preloadExpressionPreviewSprite();
    else if (mode === "makeup") preloadMakeupPresetSprites();
    setAngleOpen(false);
    setLightOpen(false);
    setGridGenMenuOpen(false);
    setHdMenuOpen(false);
    setPortraitPanel((current) => current === mode ? null : mode);
  }, []);

  const handleGenerateSubjectTurnaround = useCallback(() => {
    if (Date.now() - directPortraitActionAtRef.current < 800) return;
    directPortraitActionAtRef.current = Date.now();
    setPortraitPanel(null);
    const title = node.type === CHARACTER_NODE_TYPE
      ? "角色三视图"
      : node.type === SCENE_NODE_TYPE
        ? "场景三视图"
        : "主体三视图";
    generateEdited(title, SUBJECT_TURNAROUND_PROMPT, { ratio: "16:9" });
  }, [generateEdited, node.type]);

  const handleGenerateSubjectCloseup = useCallback(() => {
    if (Date.now() - directPortraitActionAtRef.current < 800) return;
    directPortraitActionAtRef.current = Date.now();
    setPortraitPanel(null);
    generateEdited(
      node.type === CHARACTER_NODE_TYPE
        ? imageDerivativeTitle(node.title, "角色特写图")
        : "主体特写图",
      [
        "以参考图中的核心主体为唯一身份与造型基准，生成高质量近距离特写图。",
        "如果主体是人物，使用胸像到面部的 85mm 人像构图，严格保持五官骨相、脸型、年龄、发型发色、肤色、服饰与饰品关键特征；如果主体是物体，则保持产品造型、材质、配色与标识细节。",
        "主体清晰、细节自然、背景简洁协调，不换人、不改变设计、不过度磨皮，不增加文字、水印或额外主体。",
      ].join(" "),
      // gpt-image-2 的 edits 接口不支持 3:4，但支持最接近的竖幅 2:3。
      // 其他模型仍按后台配置依次选择最合适的竖幅，避免预设绕过模型能力。
      {
        ratio: resolvePresetRatio(["2:3", "3:4", "9:16", "1:1"], ratioValues),
        outputNodeType: node.type === CHARACTER_NODE_TYPE ? CHARACTER_NODE_TYPE : "image",
      },
    );
  }, [generateEdited, node.title, node.type, ratioValues]);

  const handleGenerateExpressionGrid = useCallback(() => {
    if (Date.now() - directPortraitActionAtRef.current < 800) return;
    directPortraitActionAtRef.current = Date.now();
    setPortraitPanel(null);
    generateEdited(
      "表情九宫格",
      [
        "输出一张 1:1 的 3×3 等分头像九宫格。九格必须是参考图中的同一人物、同一正面机位、同一裁切、同一背景与同一光照。",
        "九格从左到右、从上到下依次表现：中性、微笑、大笑、惊讶、愤怒、悲伤、害怕、厌恶、自信。",
        "只改变真实自然的面部表情，身份、五官结构、脸型、发型、妆容、服饰与画风完全一致；格线整齐，不生成文字、水印或额外人物。",
      ].join(" "),
      { ratio: "1:1" },
    );
  }, [generateEdited]);

  const handlePortraitFeatureGenerate = useCallback((request: PortraitFeatureGenerateRequest) => {
    const references = request.references ?? [];
    const imageList = node.imageSrc ? [node.imageSrc, ...references] : references;
    setPortraitPanel(null);
    generateEdited(request.title, request.prompt, {
      ...(request.ratio ? { ratio: request.ratio } : {}),
      input: {
        ...(request.resolution ? { clarity: request.resolution, resolution: request.resolution } : {}),
        imageList,
        sourceImage: imageList[0],
        references: imageList.slice(1),
      },
    });
  }, [generateEdited, node.imageSrc]);

  const handlePortraitReferenceUpload = useCallback(async (file: File): Promise<string | null> => {
    if ((formatConfig.maxRefImages ?? 0) > 0 && (formatConfig.maxRefImages ?? 0) < 2) {
      toast.error("当前模型只支持一张参考图，请切换支持多参考图的模型");
      return null;
    }
    try {
      const result = await uploadFileSmart(file, undefined, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, "image"),
        label: "妆容参考图",
      });
      if (!result.success || !result.data?.fileUrl) {
        toast.error(result.message || "参考图上传失败");
        return null;
      }
      toast.success("妆容参考图已上传");
      return result.data.fileUrl;
    } catch {
      toast.error("参考图上传失败，请重试");
      return null;
    }
  }, [formatConfig.maxRefImages, selectedModel]);

  const portraitPointCost = useCallback((resolution?: string) => {
    if (!resolution) return pointCost;
    return matrixPrice(formatConfig.pricing, qualityKeys, keyVariants(resolution))
      ?? selectedModel?.pointCost
      ?? pointCost;
  }, [formatConfig.pricing, pointCost, qualityKeys, selectedModel?.pointCost]);

  const handleGenerateMultiAngle = useCallback(() => {
    setAngleOpen(false);
    generateEdited("多角度", buildMultiAnglePrompt());
  }, [buildMultiAnglePrompt, generateEdited]);

  // ===== 打光 =====
  const applyLightPreset = useCallback((label: string) => {
    const preset = LIGHT_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    setLightPreset(label);
    setLightDirection(preset.direction);
    setLightTemp(preset.temp);
    setLightIntensity(preset.intensity);
  }, []);

  const resetLight = useCallback(() => {
    setLightPreset("自定义");
    setLightDirection(LIGHT_DEFAULT.direction);
    setLightTemp(LIGHT_DEFAULT.temp);
    setLightIntensity(LIGHT_DEFAULT.intensity);
  }, []);

  const buildLightPrompt = useCallback(() => {
    const preset = LIGHT_PRESETS.find((p) => p.label === lightPreset);
    const dirText = LIGHT_DIRECTIONS.find((d) => d.value === lightDirection)?.text ?? "";
    const tempText = lightTemp < -15 ? "色温偏冷，白蓝色调的光线" : lightTemp > 15 ? "色温偏暖，金黄色调的光线" : "色温中性自然";
    const strengthText = lightIntensity < -15 ? "光线柔和，低对比度，阴影浅淡" : lightIntensity > 15 ? "光线强烈，明暗对比鲜明，阴影清晰" : "光比适中";
    return [
      "基于参考图对同一画面重新打光，必须保持主体身份、姿态、表情、构图、材质与背景内容完全一致，只改变光照以及由光照带来的阴影、高光、反射与整体氛围。",
      preset && preset.label !== "自定义" && preset.desc ? `${preset.desc}。` : "",
      `${dirText}，${tempText}，${strengthText}。`,
      `光影过渡真实自然，阴影方向与光源一致。输出画幅保持 ${multiAngleRatio}，不要改变画面内容与构图。`,
    ].filter(Boolean).join(" ");
  }, [lightDirection, lightIntensity, lightPreset, lightTemp, multiAngleRatio]);

  const handleGenerateLight = useCallback(() => {
    setLightOpen(false);
    generateEdited("打光", buildLightPrompt());
  }, [buildLightPrompt, generateEdited]);

  // ===== 九宫格：预设模式点选即生成 =====
  const handleGridGen = useCallback((preset: { label: string; ratio?: string; prompt: string }) => {
    setGridGenMenuOpen(false);
    generateEdited(preset.label, preset.prompt, preset.ratio ? { ratio: preset.ratio } : undefined);
  }, [generateEdited]);

  // ===== 超分：服务端 upscale 预设能力（提示词服务端注入），档位决定输出分辨率 =====
  const handleUpscale = useCallback((res: "2k" | "4k") => {
    setHdMenuOpen(false);
    generateEdited(`超分 ${res.toUpperCase()}`, "超分放大", {
      handler: "upscale",
      input: { resolution: res, clarity: res, quality: "high" },
    });
  }, [generateEdited]);

  const beginAngleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    angleDragRef.current = { x: e.clientX, y: e.clientY, yaw: angleYaw, pitch: anglePitch };
    setAngleDragging(true);
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
    setAngleDragging(false);
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
            type: derivativeNodeType,
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
          useCanvasStore.getState().updateNode(nid, { imageSrc: up.data.fileUrl, fileSize: up.data.fileSize, fileType: up.data.fileType, mimeType: up.data.mimeType });
          // 延迟回收 blob，等 React 用远端地址完成重渲，避免替换瞬间闪裂
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        } catch {
          // 上传失败:该切片无法持久化(刷新即失效),回收其 blob URL,避免永久泄漏。
          URL.revokeObjectURL(blobUrl);
          toast.error(`切片 ${slice.cellIndex + 1} 上传失败，该切片刷新后将丢失`);
        }
      });
    } catch {
      toast.error("切分失败，请稍后重试");
    } finally {
      setSplitting(false);
    }
  }, [derivativeNodeType, node.imageSrc, node.id, node.x, node.y, node.width, node.height, node.contentW, node.contentH, splitting]);

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

  // 裁剪、旋转、镜像共用确定性本地变换链路：代理取图 → canvas → 上传 →
  // 新建右侧派生节点。三者都不走 AI、不耗积分，也不会覆盖源图。
  const [localTransforming, setLocalTransforming] = useState<LocalTransformKind | null>(null);
  const handleLocalTransform = useCallback(async ({
    kind,
    transform,
    title,
    successMessage,
    outputRatio,
  }: {
    kind: LocalTransformKind;
    transform: RasterTransform;
    title: string;
    successMessage: string;
    outputRatio?: string;
  }) => {
    if (!node.imageSrc || localTransforming) return;
    if (node.uploading) {
      toast.info("图片上传中，请稍候再试");
      return;
    }

    setLocalTransforming(kind);
    try {
      const result = await transformImageRaster(node.imageSrc, transform, node.mimeType);
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-");
      const up = await uploadFileSmart(new File(
        [result.blob],
        `${node.title || "图片"}-${safeTitle}.${result.extension}`,
        { type: result.mimeType },
      ));
      if (!up.success || !up.data?.fileUrl) {
        toast.error(up.message || `${title}上传失败`);
        return;
      }

      const outputAspect = result.width / result.height;
      const outputCard = fitCardSize(outputAspect, outputRatio);
      const st = useCanvasStore.getState();
      const nid = generateNodeId();
      const { x: targetX, y: targetY } = findRightColumnSpot(st.nodes, node, cardW, outputCard.w);
      st.addNode({
        id: nid,
        type: derivativeNodeType,
        x: targetX,
        y: targetY,
        width: outputCard.w,
        height: outputCard.h,
        contentW: outputCard.w,
        contentH: outputCard.h,
        title,
        imageSrc: up.data.fileUrl,
        status: "success",
        fileSize: up.data.fileSize,
        fileType: up.data.fileType,
        mimeType: up.data.mimeType,
        ...(outputRatio ? { aspectRatio: outputRatio } : {}),
      }, true);
      st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
      st.selectNode(nid);
      toast.success(successMessage);
    } catch {
      toast.error(`${title}失败，请重试`);
    } finally {
      setLocalTransforming(null);
    }
  }, [cardW, derivativeNodeType, localTransforming, node]);

  const handleCrop = useCallback((ratio: string, aspect: number) => {
    void handleLocalTransform({
      kind: "crop",
      transform: { type: "crop", aspect },
      title: `裁剪 ${ratio}`,
      successMessage: `已裁剪为 ${ratio}`,
      outputRatio: ratio,
    });
  }, [handleLocalTransform]);

  const handleRotate = useCallback((degrees: -90 | 90 | 180) => {
    const direction = degrees === -90 ? "左转 90°" : degrees === 90 ? "右转 90°" : "旋转 180°";
    const sourceRatio = isStandardRatio(node.aspectRatio) ? node.aspectRatio : closestRatioLabel(cardAspect);
    const outputRatio = Math.abs(degrees) === 90
      ? swapRatio(sourceRatio)
      : sourceRatio;
    void handleLocalTransform({
      kind: "rotate",
      transform: { type: "rotate", degrees },
      title: direction,
      successMessage: `已${direction}`,
      outputRatio,
    });
  }, [cardAspect, handleLocalTransform, node.aspectRatio]);

  const handleMirror = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void handleLocalTransform({
      kind: "mirror",
      transform: { type: "mirror" },
      title: "镜像",
      successMessage: "已生成镜像图",
      outputRatio: isStandardRatio(node.aspectRatio) ? node.aspectRatio : closestRatioLabel(cardAspect),
    });
  }, [cardAspect, handleLocalTransform, node.aspectRatio]);

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
        type: derivativeNodeType,
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
  }, [derivativeNodeType, groupImages, node.id, node.x, node.y, node.width, node.height, node.contentW, node.contentH]);

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

  // 失焦/拖拽/多选时关闭顶部下拉，避免重新选中时下拉仍残留
  useEffect(() => {
    if (showAuxUI) return;
    const frame = requestAnimationFrame(() => {
      setGridMenuOpen(false);
      setCustomHover(null);
      angleDragRef.current = null;
      setAngleDragging(false);
      setAngleOpen(false);
      setLightOpen(false);
      setPortraitPanel(null);
      setHdMenuOpen(false);
      setGridGenMenuOpen(false);
      setBatchOpen(false);
    });
    return () => cancelAnimationFrame(frame);
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

  // 点击「超分」菜单外部时关闭
  useEffect(() => {
    if (!hdMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (hdMenuRef.current && !hdMenuRef.current.contains(e.target as Node)) setHdMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [hdMenuOpen]);

  // 点击「九宫格」菜单外部时关闭
  useEffect(() => {
    if (!gridGenMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (gridGenMenuRef.current && !gridGenMenuRef.current.contains(e.target as Node)) setGridGenMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [gridGenMenuOpen]);

  // 功能 key → 已实现 React 行为的白名单。后台只选择这些 key 并调整顺序；
  // handler、提示词、积分和状态机仍由本组件掌控。
  const topToolbarActions: ConfigurableNodeToolbarAction[] = [
    {
      key: "image.subjectTurnaround",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(event) => { stop(event); handleGenerateSubjectTurnaround(); }} title={`一键生成，预计 ${Math.ceil(pointCost)} 积分`} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <PersonStanding className="h-4 w-4" />
          {node.type === CHARACTER_NODE_TYPE ? "角色三视图" : node.type === SCENE_NODE_TYPE ? "场景三视图" : "主体三视图"}
        </button>
      ),
    },
    {
      key: "image.subjectCloseup",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); handleGenerateSubjectCloseup(); }} title={`一键生成，预计 ${Math.ceil(pointCost)} 积分`} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <ScanFace className="h-4 w-4" /> {node.type === CHARACTER_NODE_TYPE ? "角色特写图" : "主体特写图"}
        </button>
      ),
    },
    {
      key: "image.expressionGrid",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); handleGenerateExpressionGrid(); }} title={`一键生成，预计 ${Math.ceil(pointCost)} 积分`} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <LayoutGrid className="h-4 w-4" /> 表情九宫格
        </button>
      ),
    },
    {
      key: "image.makeupAdjust",
      group: "creative",
      content: (
        <button onPointerEnter={preloadMakeupPresetSprites} onFocus={preloadMakeupPresetSprites} onMouseDown={stop} onClick={(e) => { stop(e); togglePortraitPanel("makeup"); }} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${activePortraitPanel === "makeup" ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
          <WandSparkles className="h-4 w-4" /> 妆容调节
        </button>
      ),
    },
    {
      key: "image.expressionAdjust",
      group: "creative",
      content: (
        <button onPointerEnter={preloadExpressionPreviewSprite} onFocus={preloadExpressionPreviewSprite} onMouseDown={stop} onClick={(e) => { stop(e); togglePortraitPanel("expression"); }} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${activePortraitPanel === "expression" ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
          <Smile className="h-4 w-4" /> 表情调节
        </button>
      ),
    },
    {
      key: "image.portraitTexture",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); togglePortraitPanel("texture"); }} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${activePortraitPanel === "texture" ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
          <UserRound className="h-4 w-4" /> 人像质感
        </button>
      ),
    },
    {
      key: "image.panorama",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); handlePanorama(); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          {panoramaGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
          {panoramaGenerating ? "生成中" : node.is360 || existingPanorama?.imageSrc ? "查看全景" : "720°全景"}
        </button>
      ),
    },
    {
      key: "image.multiAngle",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); setPortraitPanel(null); setLightOpen(false); setAngleOpen((v) => !v); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Orbit className="h-4 w-4" /> 多角度
        </button>
      ),
    },
    {
      key: "image.relightPanel",
      group: "creative",
      content: (
        <button onMouseDown={stop} onClick={(e) => { stop(e); setPortraitPanel(null); setAngleOpen(false); setLightOpen((v) => !v); }} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Sun className="h-4 w-4" /> 打光
        </button>
      ),
    },
    {
      key: "image.gridGenerate",
      group: "process",
      closeOverflowOnSelect: false,
      content: (
        <div className="relative" ref={gridGenMenuRef}>
          <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); setGridGenMenuOpen((v) => !v); }} aria-haspopup="menu" aria-expanded={gridGenMenuOpen} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors ${gridGenMenuOpen ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
            <LayoutGrid className="h-4 w-4" /> 九宫格 <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${gridGenMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {gridGenMenuOpen && (
            <div role="menu" aria-label="九宫格生成预设" onMouseDown={stop} className={`thin-scroll absolute left-0 top-full z-30 mt-2 max-h-96 w-56 overflow-y-auto ${TOOLBAR_MENU_SURFACE}`}>
              <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                <span>生成预设</span>
                <span className="font-normal text-neutral-400 dark:text-neutral-500">基于当前图片</span>
              </div>
              {GRID_GEN_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  role="menuitem"
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); handleGridGen(preset); }}
                  className={`${TOOLBAR_MENU_ITEM} h-10 gap-2.5 px-2`}
                >
                  <span className="flex h-7 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100/90 text-neutral-500 ring-1 ring-inset ring-neutral-200/60 transition-colors group-hover:text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-400 dark:ring-white/10 dark:group-hover:text-neutral-100">
                    <preset.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{preset.label}</span>
                  {preset.ratio ? <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">{preset.ratio}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "tool.upscale",
      group: "process",
      closeOverflowOnSelect: false,
      content: (
        <div className="relative" ref={hdMenuRef}>
          <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); setHdMenuOpen((v) => !v); }} aria-haspopup="menu" aria-expanded={hdMenuOpen} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors ${hdMenuOpen ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
            <span className="flex h-4 items-center rounded bg-neutral-200 px-1 text-[10px] font-medium leading-none text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">HD</span>
            超分 <Gem className="-ml-1 h-3 w-3 fill-violet-400 text-violet-500" /> <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${hdMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {hdMenuOpen && (
            <div role="menu" aria-label="输出清晰度" onMouseDown={stop} className={`absolute left-0 top-full z-30 mt-2 w-56 ${TOOLBAR_MENU_SURFACE}`}>
              <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                <span>输出清晰度</span>
                <span className="font-normal text-neutral-400 dark:text-neutral-500">消耗积分</span>
              </div>
              {([
                { res: "2k", label: "超分至 2K", description: "适合屏幕与社媒" },
                { res: "4k", label: "超分至 4K", description: "适合高清交付" },
              ] as const).map((option) => (
                <button
                  key={option.res}
                  type="button"
                  role="menuitem"
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); handleUpscale(option.res); }}
                  className={`${TOOLBAR_MENU_ITEM} h-12 gap-2.5 px-2`}
                >
                  <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-[10px] bg-violet-50 text-[11px] font-semibold text-violet-600 ring-1 ring-inset ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/15">
                    {option.res.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-4">{option.label}</span>
                    <span className="block text-[11px] leading-4 text-neutral-400 dark:text-neutral-500">{option.description}</span>
                  </span>
                  <span className="flex items-center gap-0.5 rounded-lg bg-neutral-100 px-1.5 py-1 text-[11px] font-medium text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
                    <Zap className="h-3 w-3 text-amber-500" fill="currentColor" />
                    {Math.ceil(matrixPrice(formatConfig.pricing, keyVariants("high"), keyVariants(option.res)) ?? selectedModel?.pointCost ?? 18)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "image.crop",
      group: "process",
      closeOverflowOnSelect: false,
      content: (
        <ImageTransformMenu
          mode="crop"
          busy={localTransforming === "crop"}
          onCrop={handleCrop}
        />
      ),
    },
    {
      key: "image.rotate",
      group: "process",
      closeOverflowOnSelect: false,
      content: (
        <ImageTransformMenu
          mode="rotate"
          busy={localTransforming === "rotate"}
          onRotate={handleRotate}
        />
      ),
    },
    {
      key: "image.gridSplit",
      group: "process",
      closeOverflowOnSelect: false,
      content: (
        <div className="relative" ref={gridMenuRef}>
          <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); setGridMenuOpen((v) => !v); }} disabled={splitting} aria-haspopup="menu" aria-expanded={gridMenuOpen} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors disabled:opacity-60 ${gridMenuOpen ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
            {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table className="h-4 w-4" />}
            宫格切分 <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${gridMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {gridMenuOpen && (
            <div role="menu" aria-label="宫格切分布局" onMouseDown={stop} className={`absolute left-0 top-full z-30 mt-2 w-52 ${TOOLBAR_MENU_SURFACE}`}>
              <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                <span>宫格切分</span>
                <span className="font-normal text-neutral-400 dark:text-neutral-500">选择布局</span>
              </div>
              {[{ label: "4 宫格", n: 2 }, { label: "9 宫格", n: 3 }, { label: "16 宫格", n: 4 }, { label: "25 宫格", n: 5 }].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="menuitem"
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); enterGridPreview(option.n, option.n); }}
                  className={`${TOOLBAR_MENU_ITEM} h-10 gap-2.5 px-2`}
                >
                  <GridPreview size={option.n} />
                  <span className="flex-1 text-[13px] font-medium">{option.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">{option.n} × {option.n}</span>
                </button>
              ))}
              <div className="mx-2 my-1.5 h-px bg-neutral-200/80 dark:bg-white/10" />
              <div
                className="relative"
                onMouseEnter={() => setCustomHover((hover) => hover ?? { r: 1, c: 1 })}
                onMouseLeave={() => setCustomHover(null)}
              >
                <button type="button" role="menuitem" aria-haspopup="grid" onMouseDown={stop} className={`${TOOLBAR_MENU_ITEM} h-10 gap-2.5 px-2`}>
                  <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-[10px] bg-neutral-100/90 text-neutral-500 ring-1 ring-inset ring-neutral-200/60 dark:bg-white/[0.06] dark:text-neutral-400 dark:ring-white/10">
                    <LayoutGrid className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-[13px] font-medium">自定义布局</span>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
                </button>
                {customHover && (
                  <div role="grid" aria-label="自定义宫格布局" onMouseDown={stop} className={`absolute left-full top-0 ml-2 p-3 ${TOOLBAR_MENU_SURFACE}`}>
                    <div className="mb-2.5 flex items-center justify-between gap-8 px-0.5">
                      <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-200">自定义布局</span>
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] tabular-nums text-neutral-500 dark:bg-white/[0.07] dark:text-neutral-400">{customHover.c} × {customHover.r}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {Array.from({ length: CUSTOM_MAX }, (_, rowIndex) => (
                        <div key={rowIndex} role="row" className="flex gap-1">
                          {Array.from({ length: CUSTOM_MAX }, (_, columnIndex) => {
                            const row = rowIndex + 1;
                            const column = columnIndex + 1;
                            const active = row <= customHover.r && column <= customHover.c;
                            return (
                              <button
                                key={columnIndex}
                                type="button"
                                role="gridcell"
                                aria-label={`${column} 列 × ${row} 行`}
                                onMouseDown={stop}
                                onMouseEnter={() => setCustomHover({ r: row, c: column })}
                                onClick={(e) => { stop(e); enterGridPreview(row, column); }}
                                className={`h-5 w-5 rounded-[4px] border transition-all duration-100 ${active ? "border-blue-400/80 bg-blue-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] dark:border-blue-400 dark:bg-blue-500" : "border-neutral-200/80 bg-neutral-100 hover:border-neutral-300 dark:border-white/10 dark:bg-white/[0.06] dark:hover:border-white/20"}`}
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
      ),
    },
    {
      key: "media.replace",
      group: "media",
      overflowLabel: "替换图片",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={openFilePicker}
          disabled={nodeUploading || generating}
          title={generating ? "生成完成后可替换素材" : "重新上传 / 图生图"}
          aria-label={generating ? "生成完成后可替换素材" : "替换图片"}
          className="rounded-xl p-2 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
        >
          <Brush className="h-4 w-4" />
        </button>
      ),
    },
    {
      key: "image.mirror",
      group: "process",
      content: (
        <button onMouseDown={stop} onClick={handleMirror} disabled={localTransforming === "mirror"} title="镜像（水平翻转）" className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
          {localTransforming === "mirror" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlipHorizontal2 className="h-4 w-4" />}
          镜像
        </button>
      ),
    },
    {
      key: "media.download",
      group: "media",
      overflowLabel: "下载图片",
      content: (
        <button type="button" onMouseDown={stop} onClick={(e) => handleDownload(e, node.imageSrc, node.title || "image", "png")} disabled={downloading} title="下载" aria-label="下载图片" className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      ),
    },
    {
      key: "media.preview",
      group: "media",
      overflowLabel: "查看大图",
      content: (
        <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); setPreviewOpen(true); }} title="查看大图" aria-label="查看大图" className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Maximize2 className="h-4 w-4" />
        </button>
      ),
    },
  ];
  const hasTopToolbarActions = topToolbarActions.some((action) =>
    configuredFeatures.includes(action.key),
  );

  // A 360° node has a context-specific toolbar, but it still consumes the
  // same administrator-authored feature list and order as every other image
  // node. Controls that only make sense inside the panorama viewer are
  // registered as their own capabilities instead of being rendered implicitly.
  const panoramaToolbarActions: ConfigurableNodeToolbarAction[] = [
    {
      key: "image.panoramaCapture",
      group: "process",
      overflowLabel: "当前视角截图",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            void handlePanoCapture();
          }}
          title="当前视角截图"
          aria-label="当前视角截图"
          aria-busy={panoCaptureBusy === "single"}
          disabled={panoCaptureBusy !== null}
          className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-55 dark:hover:bg-neutral-800"
        >
          {panoCaptureBusy === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </button>
      ),
    },
    {
      key: "image.panoramaCaptureGrid",
      group: "process",
      overflowLabel: "4 大视角截图",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            void handlePanoCapture4();
          }}
          title="4 大视角截图"
          aria-label="4 大视角截图"
          aria-busy={panoCaptureBusy === "grid"}
          disabled={panoCaptureBusy !== null}
          className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-55 dark:hover:bg-neutral-800"
        >
          {panoCaptureBusy === "grid" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid2x2 className="h-4 w-4" />}
        </button>
      ),
    },
    {
      key: "image.panoramaGuide",
      group: "process",
      overflowLabel: panoGrid ? "隐藏参考线" : "显示参考线",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            setPanoGrid((current) => !current);
          }}
          title={panoGrid ? "隐藏构图参考线" : "显示构图参考线"}
          aria-label={panoGrid ? "隐藏构图参考线" : "显示构图参考线"}
          aria-pressed={panoGrid}
          className={`rounded-xl p-2 transition-colors ${panoGrid ? "bg-neutral-100 text-blue-600 dark:bg-neutral-800 dark:text-blue-400" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
        >
          <Hash className="h-4 w-4" />
        </button>
      ),
    },
    {
      key: "image.panoramaReset",
      group: "process",
      overflowLabel: "复位视角",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            panoApiRef.current?.reset();
          }}
          title="复位视角"
          aria-label="复位视角"
          className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      ),
    },
    {
      // Keep V4 behavior: media.preview means opening the interactive, full-
      // screen panorama rather than a flat image lightbox.
      key: "media.preview",
      group: "media",
      overflowLabel: "全屏查看",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            handlePanorama();
          }}
          title="全屏查看全景"
          aria-label="全屏查看全景"
          className="rounded-xl p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      ),
    },
    {
      key: "media.download",
      group: "media",
      overflowLabel: "下载全景图",
      content: (
        <button
          type="button"
          onMouseDown={stop}
          onClick={(event) => handleDownload(event, node.imageSrc, node.title || "image", "png")}
          disabled={downloading}
          title="下载"
          aria-label="下载全景图"
          className="rounded-xl p-2 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      ),
    },
  ];
  const hasPanoramaToolbarActions = panoramaToolbarActions.some((action) =>
    configuredFeatures.includes(action.key),
  );

  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      {/* 卡片尺寸的定位容器（居中）；外置组件以卡片边缘为锚做恒定大小覆盖层 */}
      <div className="relative mx-auto" style={{ width: cardW }}>
        {/* 标题：恒定大小，吸附卡片左上方 */}
        {showAuxUI && !node.imageSrc && configuredFeatures.includes("media.replace") && (
          <NodeChrome placement="top-left" gap={10}>
            <EditableImageNodeTitle node={node} />
          </NodeChrome>
        )}
        {/* 右上角分辨率（上传/生成后展示 W × H）。只在确有图片时显示——探测异步，
            上传失败后 probe 可能仍晚回填一次 imageDims，用 node.imageSrc 兜底防残留 */}
        {showAuxUI && imageDims && node.imageSrc && (
          <NodeDimsBadge dims={imageDims} />
        )}
        {showAuxUI && !node.imageSrc && configuredFeatures.includes("media.replace") && (
          <NodeChrome placement="top-center" gap={8} zIndex={20}>
            <div onMouseDown={stop} className="flex items-center gap-0.5 whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <button
                type="button"
                onMouseDown={stop}
                onClick={openFilePicker}
                disabled={nodeUploading || generating}
                title={generating ? "生成完成后可上传素材" : "上传图片"}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
              >
                {nodeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                上传
              </button>
            </div>
          </NodeChrome>
        )}
        {/* 已生成 + 非预览：顶部操作工具栏（恒定大小独立胶囊，吸附卡片左上方）。
            zIndex 抬到端口(默认 10)之上，避免「宫格切分」下拉被端口 + 盖住 */}
        {showAuxUI && node.imageSrc && !gridPreview && !node.is360 && hasTopToolbarActions && (
          <NodeChrome placement="top-center" gap={10} zIndex={20}>
            <ConfigurableNodeToolbar
              featureKeys={configuredFeatures}
              actions={topToolbarActions}
              maxPrimaryActions={9}
              onMouseDown={stop}
              ariaLabel={`${node.title || "图片节点"}顶部功能`}
            />
          </NodeChrome>
        )}
        {/* 720° 全景：与普通图片共用后台 featureKeys，只渲染当前上下文可用的动作。 */}
        {showAuxUI && node.imageSrc && node.is360 && !gridPreview && hasPanoramaToolbarActions && (
          <NodeChrome placement="top-center" gap={10} zIndex={20}>
            <ConfigurableNodeToolbar
              featureKeys={configuredFeatures}
              actions={panoramaToolbarActions}
              onMouseDown={stop}
              ariaLabel={`${node.title || "全景图片节点"}顶部功能`}
            />
          </NodeChrome>
        )}
        {/* 已生成 + 预览模式：切分操作栏（恒定大小独立胶囊） */}
        {showAuxUI && node.imageSrc && gridPreview && (
          <NodeChrome placement="top-center" gap={10}>
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
        {showAuxUI && activePortraitPanel && node.imageSrc && !gridPreview && (
          <NodeChrome placement="bottom-center" gap={18} zIndex={40}>
            <PortraitFeaturePanel
              key={activePortraitPanel}
              mode={activePortraitPanel}
              resolutionOptions={clarityValues}
              allowReferenceUpload={(formatConfig.maxRefImages ?? 0) === 0 || (formatConfig.maxRefImages ?? 0) >= 2}
              resolvePointCost={portraitPointCost}
              onClose={() => setPortraitPanel(null)}
              onGenerate={handlePortraitFeatureGenerate}
              onUploadReference={handlePortraitReferenceUpload}
            />
          </NodeChrome>
        )}

        {showAuxUI && angleOpen && node.imageSrc && !gridPreview && (
          <NodeChrome placement="bottom-center" gap={18} zIndex={30}>
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
                        transition: angleDragging ? "none" : "transform 180ms ease",
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
                        <img
                          src={ossDisplayUrl(node.imageSrc, 512)}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
                          onError={(event) => fallbackOssDisplayImage(event.currentTarget, node.imageSrc)}
                        />
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
                  {/* 3 列等宽网格：6 个预设正好两行，避免 flex-wrap 右侧参差；
                      未选中态用弱边框而非 bg-neutral-100（白底上几乎不可见，读起来像纯文本） */}
                  <div className="mb-5 grid grid-cols-3 gap-2">
                    {MULTI_ANGLE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onMouseDown={stop}
                        onClick={(e) => { stop(e); applyAnglePreset(preset.label); }}
                        className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                          anglePreset === preset.label
                            ? "bg-neutral-900 text-white dark:bg-white/28 dark:text-white"
                            : "border border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/12 dark:text-white/75 dark:hover:border-white/25 dark:hover:bg-white/5 dark:hover:text-white"
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
                      <label key={item.label} className="grid grid-cols-[66px_1fr_34px] items-center gap-3 text-xs">
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
                    className="mt-5 flex items-center justify-between text-left text-xs"
                  >
                    <span className="text-neutral-500 dark:text-white/45">广角镜头</span>
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
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </button>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-xs text-neutral-400 dark:text-white/38">
                    <Zap className="h-3.5 w-3.5" fill="currentColor" />
                    {Math.ceil(pointCost)}
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

        {/* 打光：跟随图片节点的内联控制面板（结构与多角度面板一致） */}
        {showAuxUI && lightOpen && node.imageSrc && !gridPreview && (
          <NodeChrome placement="bottom-center" gap={18} zIndex={30}>
            <div
              onMouseDown={stop}
              className="w-[380px] overflow-hidden rounded-[14px] bg-white p-5 text-neutral-800 shadow-2xl ring-1 ring-neutral-200/80 dark:bg-[#29292b] dark:text-white dark:ring-white/8"
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">调整光照</h3>
                <button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); setLightOpen(false); }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/80"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-5 grid grid-cols-3 gap-2">
                {LIGHT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); applyLightPreset(preset.label); }}
                    className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                      lightPreset === preset.label
                        ? "bg-neutral-900 text-white dark:bg-white/28 dark:text-white"
                        : "border border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/12 dark:text-white/75 dark:hover:border-white/25 dark:hover:bg-white/5 dark:hover:text-white"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="mb-5">
                <div className="mb-2 text-xs text-neutral-500 dark:text-white/45">光源方向</div>
                <div className="grid grid-cols-5 gap-2">
                  {LIGHT_DIRECTIONS.map((dir) => (
                    <button
                      key={dir.value}
                      onMouseDown={stop}
                      onClick={(e) => { stop(e); setLightPreset("自定义"); setLightDirection(dir.value); }}
                      className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                        lightDirection === dir.value
                          ? "bg-neutral-900 text-white dark:bg-white/28 dark:text-white"
                          : "border border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/12 dark:text-white/75 dark:hover:border-white/25 dark:hover:bg-white/5 dark:hover:text-white"
                      }`}
                    >
                      {dir.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                {[
                  { label: "色温", value: lightTemp, hintLow: "冷", hintHigh: "暖", onChange: setLightTemp },
                  { label: "强度", value: lightIntensity, hintLow: "柔和", hintHigh: "强烈", onChange: setLightIntensity },
                ].map((item) => (
                  <label key={item.label} className="grid grid-cols-[66px_1fr_34px] items-center gap-3 text-xs">
                    <span className="text-neutral-500 dark:text-white/45">{item.label}</span>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      value={item.value}
                      onMouseDown={stop}
                      onChange={(e) => {
                        setLightPreset("自定义");
                        item.onChange(Number(e.target.value));
                      }}
                      className="slider-thin"
                      style={{ "--pct": `${((item.value + 50) / 100) * 100}%` } as React.CSSProperties}
                    />
                    <span className="text-right font-semibold tabular-nums text-neutral-600 dark:text-white/65">{item.value > 0 ? "+" : ""}{item.value}</span>
                  </label>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between">
                <button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); resetLight(); }}
                  className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-700 dark:text-white/42 dark:hover:text-white/75"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </button>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-xs text-neutral-400 dark:text-white/38">
                    <Zap className="h-3.5 w-3.5" fill="currentColor" />
                    {Math.ceil(pointCost)}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); handleGenerateLight(); }}
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
        {previewOpen && node.imageSrc && (
          <NodeMediaLightbox onClose={() => setPreviewOpen(false)} title={node.title}>
            {currentPreviewMedia.failed ? (
              <div
                className="flex min-h-48 min-w-72 flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-neutral-950/90 px-8 text-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <ImageIcon className="h-8 w-8 text-white/35" aria-hidden />
                <span className="text-sm text-white/70">图片暂时无法加载</span>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewMediaState({
                      src: currentImageSrc,
                      failed: false,
                      retry: currentPreviewMedia.retry + 1,
                    });
                  }}
                >
                  重新加载
                </button>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${currentImageSrc}:${currentPreviewMedia.retry}`}
                src={node.imageSrc}
                alt=""
                className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
                onError={() => setPreviewMediaState({
                  src: currentImageSrc,
                  failed: true,
                  retry: currentPreviewMedia.retry,
                })}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </NodeMediaLightbox>
        )}

        {/* 组图：右侧堆叠纸张效果（置于主卡之下） */}
        {groupImages && (
          <>
            <div className="absolute rounded-[12px] bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                 style={{ left: 16, right: -16, top: 8, height: cardH - 16 }} />
            <div className="absolute rounded-[12px] bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                 style={{ left: 8, right: -8, top: 4, height: cardH - 8 }} />
          </>
        )}

        {/* 主图片区 - 始终显示（作为容器内唯一在流元素，决定容器尺寸） */}
        <Paper
          component="div"
          radius={10}
          shadow="none"
          className={`relative overflow-hidden border bg-white transition-[border-color,box-shadow] dark:bg-neutral-950 ${
            isConnectTarget
              ? "border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
              : isSelected
                ? "border-neutral-400 shadow-[0_0_0_1px_rgba(115,115,115,0.28)] dark:border-neutral-500"
                : "border-neutral-300 dark:border-neutral-700"
          }`}
          style={{ width: cardW, height: cardH }}
          withBorder={false}
        >
          {/* 拉片分镜的编号与语义标签必须常驻，不能依赖节点选中态；否则成组浏览时无法识别镜头。 */}
          {node.storyboardFrame && (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[6] flex items-center gap-1.5 bg-gradient-to-b from-black/75 to-transparent px-2.5 pb-5 pt-2 text-white">
                <span className="truncate text-[11px] font-medium">{node.title}</span>
                {node.storyboardFrame.shotSize && (
                  <span className="shrink-0 rounded border border-white/10 bg-black/45 px-1.5 py-0.5 text-[10px] text-white/90">
                    {node.storyboardFrame.shotSize}
                  </span>
                )}
                {node.storyboardFrame.motion && (
                  <span className="min-w-0 truncate text-[10px] text-white/70">
                    · {node.storyboardFrame.motion}
                  </span>
                )}
              </div>
              {(node.storyboardFrame.description || node.storyboardFrame.musicCue) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2.5 pb-2 pt-7 text-[10px] leading-4 text-white">
                  {node.storyboardFrame.description && <p className="line-clamp-2">{node.storyboardFrame.description}</p>}
                  {node.storyboardFrame.musicCue && (
                    <p className="mt-0.5 truncate text-white/65">音乐：{node.storyboardFrame.musicCue}</p>
                  )}
                </div>
              )}
            </>
          )}
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
          {generating && <NodeGeneratingOverlay label="AI 生成中..." />}
          {/* 上传中遮罩：模糊预览 + 百分比 */}
          {nodeUploading && <NodeUploadingOverlay pct={nodeUploadPct} previewSrc={uploadPreviewSrc} kind="image" />}
          {/* 错误状态 */}
          {node.status === "error" && !generating && !node.imageSrc && <NodeErrorBadge />}
          {/* 宫格切分预览：网格线 + 可点选格子（选中则只切选中，不选则全部） */}
          {gridPreview && node.imageSrc && (
            <div className="absolute inset-0 z-[4] overflow-hidden rounded-[12px]">
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
            ) : currentCardMedia.failed ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-50 text-neutral-500 dark:bg-neutral-950 dark:text-white/45">
                <ImageIcon className="h-7 w-7 opacity-60" aria-hidden />
                <span className="text-xs">图片暂时无法加载</span>
                <button
                  type="button"
                  onMouseDown={stop}
                  onClick={(e) => {
                    stop(e);
                    setCardMediaState({
                      src: currentImageSrc,
                      useOriginal: false,
                      failed: false,
                      retry: currentCardMedia.retry + 1,
                    });
                  }}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-white/65 dark:hover:bg-neutral-900"
                >
                  重试
                </button>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${currentImageSrc}:${currentCardMedia.useOriginal ? "original" : "optimized"}:${currentCardMedia.retry}`}
                src={activeCardImageSrc}
                alt=""
                draggable={false}
                onError={() => {
                  if (!currentCardMedia.useOriginal && node.imageSrc && cardDisplaySrc !== node.imageSrc) {
                    disableOssDisplayProcessing(node.imageSrc);
                    setCardMediaState({
                      src: currentImageSrc,
                      useOriginal: true,
                      failed: false,
                      retry: currentCardMedia.retry,
                    });
                    return;
                  }
                  setCardMediaState({
                    src: currentImageSrc,
                    useOriginal: currentCardMedia.useOriginal,
                    failed: true,
                    retry: currentCardMedia.retry,
                  });
                }}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  if (t.naturalWidth > 0 && t.naturalHeight > 0) {
                    // 降采样不改变宽高比,aspect 用展示图即可
                    setImgAspectState({ src: node.imageSrc || "", aspect: t.naturalWidth / t.naturalHeight });
                    setImageDims({ w: t.naturalWidth, h: t.naturalHeight });
                    // 展示图被 OSS 降采样时,分辨率标签改用 image/info 拿原图尺寸
                    //（跨域/无权限等失败则保留展示图尺寸,仅标签略小,不影响功能）
                    const orig = node.imageSrc;
                    if (orig && cardDisplaySrc !== orig) {
                      fetch(`${orig}?x-oss-process=image/info`)
                        .then((r) => (r.ok ? r.json() : null))
                        .then((info) => {
                          const w = Number(info?.ImageWidth?.value);
                          const h = Number(info?.ImageHeight?.value);
                          if (mountedRef.current && w > 0 && h > 0) setImageDims({ w, h });
                        })
                        .catch(() => {});
                    }
                  }
                }}
                className="h-full w-full object-contain"
              />
            )
          ) : (
            <Center h="100%" p="xl" c="gray.9" className="relative dark:text-neutral-100">
              <Center style={{ position: "absolute", insetInline: 0, top: "28%" }}>
                <ThemeIcon variant="transparent" color="gray" size={82} radius="xl">
                  <ImageIcon size={58} strokeWidth={1.5} />
                </ThemeIcon>
              </Center>

              <Stack gap="sm" align="flex-start" style={{ position: "absolute", left: 28, top: "45%" }}>
                <Text size="sm" c="dimmed">尝试：</Text>
                <Button
                  onMouseDown={stop}
                  onClick={openFilePicker}
                  disabled={nodeUploading || generating}
                  title={generating ? "生成完成后可上传素材" : undefined}
                  variant="subtle"
                  color="dark"
                  radius="md"
                  size="sm"
                  leftSection={
                    <ThemeIcon variant="light" color="gray" size={24} radius="md">
                      {nodeUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    </ThemeIcon>
                  }
                  styles={{ root: { paddingLeft: 8, paddingRight: 10 }, label: { fontWeight: 500 } }}
                >
                  图生图
                </Button>
                <Button
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); toast.info("图片高清功能即将上线"); }}
                  variant="subtle"
                  color="dark"
                  radius="md"
                  size="sm"
                  leftSection={
                    <ThemeIcon variant="light" color="gray" size={24} radius="md">
                      <Text size="10px" fw={600} lh={1}>HD</Text>
                    </ThemeIcon>
                  }
                  styles={{ root: { paddingLeft: 8, paddingRight: 10 }, label: { fontWeight: 500 } }}
                >
                  图片高清
                </Button>
              </Stack>
            </Center>
          )}

        </Paper>

        {/* 左右连接端口：恒定大小，吸附卡片左右缘中点 */}
        <NodePorts
          nodeId={node.id}
          visible={showAuxUI}
          overlay
          onPortMouseDown={onPortMouseDown}
          inputTitle="输入端口（从其他节点拖入）"
          outputTitle="输出端口（拖到其他节点）"
        />

        {/* 提示词输入面板：恒定大小，吸附卡片正下方居中 */}
        {showAuxUI && !node.imageSrc && (
          <NodeChrome placement="bottom-center" gap={18}>
            <Paper
              component="div"
              radius={10}
              p={12}
              shadow="sm"
              withBorder
              className="relative flex flex-col bg-white shadow-[0_10px_32px_rgba(15,23,42,0.10)] dark:bg-neutral-950 dark:shadow-black/30"
              style={{ width: promptPanelW, minHeight: 176, boxSizing: "border-box" }}
            >
              {/* 富文本输入框（@ 引用「图片N」内联绑定参考图）：风格作前置工具、展开作后置 */}
              <PromptRefEditor
                refs={refs}
                value={node.prompt || ""}
                onChange={handlePromptChange}
                onSubmit={() => { if (!generating && !nodeUploading && hasPromptSource) handleGenerate(); }}
                placeholder={promptPlaceholder}
                leading={
                  <ImageStylePicker
                    value={selectedStyleId}
                    selectedName={selectedStyleName}
                    selectedPrompt={selectedStylePrompt}
                    modelId={selectedModelId}
                    onChange={handleStylePresetChange}
                  />
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
                placeholder={promptPlaceholder}
              />
              <div className="mt-auto flex items-center gap-2 pt-5">
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                  <ModelPicker models={imageModels} value={selectedModelId} onChange={setSelectedModelId} />
                  <QualityRatioPicker
                    value={qualityRatio}
                    onChange={(v) => {
                      // 用户手动改过比例后，不再跟随上游连接节点的默认比例
                      if (v.ratio !== qualityRatio.ratio) setRatioTouched(true);
                      setQualityRatio(v);
                    }}
                    qualities={formatConfig.qualities}
                    clarities={formatConfig.clarities ?? formatConfig.resolutions}
                    ratios={formatConfig.ratios}
                    compact
                  />
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <BatchCountDropdown
                    value={batchCount}
                    options={batchOptions}
                    open={batchOpen}
                    onOpenChange={setBatchOpen}
                    onChange={setBatchCount}
                    variant="ghost"
                    align="right"
                  />
                  <span className="flex items-center gap-0.5 text-xs text-neutral-500">
                    <Zap className="h-3 w-3 text-neutral-900 dark:text-neutral-100" fill="currentColor" />
                    {Math.ceil(pointCost * batchCount)}
                  </span>
                  <button
                    onMouseDown={stop}
                    onClick={(e) => { stop(e); handleGenerate(); }}
                    disabled={generating || nodeUploading || !hasPromptSource}
                    title={generating ? "生成中..." : nodeUploading ? "素材上传中..." : !hasPromptSource ? "先输入提示词" : "开始生成"}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      generating || nodeUploading || !hasPromptSource
                        ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                        : "bg-neutral-800 text-white hover:bg-neutral-950 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                    }`}
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </Paper>
          </NodeChrome>
        )}
      </div>
    </NodeShell>
  );
});
