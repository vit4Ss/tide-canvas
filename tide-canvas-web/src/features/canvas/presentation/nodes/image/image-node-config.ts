import {
  Contrast,
  Film,
  Grid2x2,
  LayoutGrid,
  Mountain,
  Package,
  ScanFace,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { getImageCardSizeForRatio } from "@/lib/image-card-size";
import type { CanvasNode } from "../../../domain/models/canvas-document";
import {
  CLARITY_OPTIONS,
  QUALITY_OPTIONS,
  RATIO_OPTIONS,
} from "@/components/canvas/nodes/quality-ratio-picker";
import type { ImageStylePreset } from "@/components/canvas/nodes/image-style-picker";
import { STYLE_REFERENCE_NODE_TYPE } from "@/components/canvas/nodes/style-reference-node";

export const CUSTOM_MAX = 8;
export const PANEL_EXTRA = 80;
export const STYLE_REFERENCE_WIDTH = 320;
export const STYLE_REFERENCE_HEIGHT = 356;
export const STYLE_REFERENCE_GAP = 92;
export const DEFAULT_BATCH_OPTIONS: number[] = [1, 2, 4];
export const DEFAULT_QUALITY_VALUES: string[] = QUALITY_OPTIONS.map((quality) => quality.value);
export const DEFAULT_CLARITY_VALUES: string[] = [...CLARITY_OPTIONS];

export function fitCardSize(aspect: number, ratio?: string | null) {
  return getImageCardSizeForRatio(ratio, aspect);
}

export function isStandardRatio(ratio?: string | null): ratio is string {
  return Boolean(
    ratio
    && ratio !== "auto"
    && RATIO_OPTIONS.some((option) => option.value === ratio),
  );
}

export function getStyleReferenceTitle(preset: ImageStylePreset): string {
  return `素材-风格-${preset.shortName || preset.name || "未命名风格"}`;
}

export function getStyleReferencePatch(preset: ImageStylePreset): Partial<CanvasNode> {
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

export function getStylePromptForModel(
  prompt: string,
  modelPrompts?: Record<string, string>,
  modelId?: string,
): string {
  const modelPrompt = modelId ? modelPrompts?.[modelId]?.trim() : "";
  return modelPrompt || prompt || "";
}

export const panoramaPrompt = (ratio: string) =>
  `将这张图扩展生成 360° 环绕全景图（equirectangular panorama，宽高比 ${ratio}）。必须让画面最左边缘与最右边缘无缝闭合，纹理、光照、颜色和透视连续，不能出现垂直拼接线、色块断层或重复硬边。向四周自然延展场景，保持主体、风格与光照一致，适合球面环绕观看。`;

export const MULTI_ANGLE_DEFAULT = { yaw: -28, pitch: -8, zoom: 0, wideLens: false };
export const ANGLE_CUBE = { w: 164, h: 92, d: 92 };
export const MULTI_ANGLE_PRESETS = [
  { label: "自定义", ...MULTI_ANGLE_DEFAULT },
  { label: "鱼眼视角", yaw: -42, pitch: 6, zoom: -12, wideLens: true },
  { label: "倾斜视角", yaw: -36, pitch: -22, zoom: 8, wideLens: false },
  { label: "正面俯拍", yaw: 0, pitch: -32, zoom: 4, wideLens: false },
  { label: "正面仰拍", yaw: 0, pitch: 24, zoom: 6, wideLens: false },
  { label: "全景俯拍", yaw: -54, pitch: -36, zoom: -8, wideLens: true },
] as const;

export const LIGHT_DIRECTIONS = [
  { value: "left", label: "左侧", text: "主光从画面左侧打来，右侧留出自然阴影" },
  { value: "front", label: "正面", text: "主光从正面均匀照亮主体" },
  { value: "right", label: "右侧", text: "主光从画面右侧打来，左侧留出自然阴影" },
  { value: "top", label: "顶光", text: "主光从上方打下，形成顶光" },
  { value: "back", label: "逆光", text: "光源位于主体后方，形成逆光轮廓" },
] as const;
export const LIGHT_DEFAULT = { direction: "front", temp: 0, intensity: 0 };
export const LIGHT_PRESETS = [
  { label: "自定义", ...LIGHT_DEFAULT, desc: "" },
  { label: "黄金时刻", direction: "left", temp: 35, intensity: 10, desc: "傍晚黄金时刻的低角度阳光，暖金色调，拉出细长柔和的影子" },
  { label: "窗边柔光", direction: "left", temp: 10, intensity: -25, desc: "大窗漫射进来的柔和自然光，明暗过渡细腻通透" },
  { label: "摄影棚", direction: "front", temp: 0, intensity: 15, desc: "专业摄影棚三点布光，主体受光均匀，背景干净" },
  { label: "霓虹夜景", direction: "right", temp: -35, intensity: 20, desc: "夜晚霓虹灯氛围，冷暖对比的城市夜色光效" },
  { label: "剪影逆光", direction: "back", temp: 10, intensity: 35, desc: "强烈逆光勾出主体轮廓光，主体偏暗接近剪影" },
] as const;

export interface GridGenerationPreset {
  label: string;
  icon: LucideIcon;
  ratio?: string;
  prompt: string;
}

export const GRID_GEN_PRESETS: GridGenerationPreset[] = [
  {
    label: "多机位九宫格",
    icon: LayoutGrid,
    prompt: "将参考图的主体生成一张 3×3 九宫格图片：九个格子是同一主体、同一场景在九个不同机位与景别下的画面——特写、近景、中景、全景、低角度仰拍、高角度俯拍、正侧面、背面、四分之三侧。必须保持主体身份、服饰/材质、色调、光照与画风完全一致；格子之间用细分隔线整齐排布，每格构图完整独立。",
  },
  {
    label: "剧情推演四宫格",
    icon: Grid2x2,
    prompt: "以参考图为第一格起点，生成一张 2×2 四宫格连续剧情分镜：四个画面按时间顺序自然推进一段合理的短剧情，镜头与动作前后衔接流畅。保持主体身份与画风一致，光照与场景连贯；格子间用细分隔线排布，阅读顺序从左到右、从上到下。",
  },
  {
    label: "角色脸部三视图",
    icon: ScanFace,
    ratio: "16:9",
    prompt: "生成参考图角色脸部的三视图，在一张图中从左到右横向排列：正面、四分之三侧面、正侧面。三个头像的五官、发型、肤色、神态严格一致，比例统一、视线水平；干净纯色浅背景，角色设定图排版风格，画风与参考图一致。",
  },
  {
    label: "角色设定图",
    icon: UserRound,
    ratio: "16:9",
    prompt: "把参考图角色生成一张完整的角色设定图（character sheet）：包含全身正面、侧面、背面三视图，头部特写，2~3 个表情小图，以及服饰/道具细节放大。白底设定图排版，标注区留白干净，所有视图的身份、体型比例、服饰细节与配色严格一致，画风与参考图一致。",
  },
  {
    label: "场景设定图",
    icon: Mountain,
    ratio: "16:9",
    prompt: "基于参考图生成一张场景美术设定图：主视角大图为核心，周围排布同一场景的不同视角小图与关键道具/结构的细节放大图，可附白天与夜晚两种光照的小图对比。概念设定图排版，构造与风格与参考图严格一致，整体干净专业。",
  },
  {
    label: "产品设定图",
    icon: Package,
    ratio: "16:9",
    prompt: "把参考图中的产品生成一张商业产品设定图：包含正面、侧面、背面、俯视多角度视图，外加材质与细节特写放大图，干净浅色背景、柔和摄影棚光。产品的造型、材质、配色与参考图严格一致，商业渲染排版风格。",
  },
  {
    label: "25宫格连贯分镜",
    icon: Film,
    prompt: "以参考图为起点生成一张 5×5 二十五宫格连贯分镜：二十五个画面是同一主体的连续镜头序列，按从左到右、从上到下的顺序推进剧情，景别与机位有节奏地变化（远近交替、角度变化）。主体身份与画风全程一致，光照与场景连贯；格子间用细分隔线整齐排布。",
  },
  {
    label: "电影级光影校正",
    icon: Contrast,
    prompt: "对参考图进行电影级调色与光影校正：优化曝光与对比度、平衡色彩、增加自然的高光层次与柔和阴影，赋予电影胶片质感的色调与氛围。严格保持画面内容、主体与构图不变，只提升光影与色彩品质。",
  },
];

export const SUBJECT_TURNAROUND_PROMPT = [
  "基于参考图中的核心主体生成一张专业三视图设定图，在同一张图中从左到右横向排列：正面、正侧面、背面。",
  "如果主体是人物，必须使用全身视图，三个视图身高比例与脚底基线严格对齐，身份、体型、五官、发型、服饰、饰品、配色和材质细节完全一致；如果主体是产品或物体，则保持结构、尺度、材质与标识细节一致。",
  "使用干净纯色浅背景和标准正交设定图排版，只改变观察方向，不增加文字、水印、额外人物或无关物体。",
].join(" ");

const COMMON_RATIOS = [
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
  { label: "2:1", value: 2 },
] as const;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const closestRatioLabel = (aspect: number) =>
  COMMON_RATIOS.reduce(
    (best, item) => Math.abs(item.value - aspect) < Math.abs(best.value - aspect) ? item : best,
    COMMON_RATIOS[0],
  ).label;

export function resolvePresetRatio(preferred: readonly string[], configured?: readonly string[]) {
  if (!configured?.length) return preferred[0];
  return preferred.find((ratio) => configured.includes(ratio)) ?? configured[0];
}

export const PORTRAIT_PANEL_FEATURES = {
  makeup: "image.makeupAdjust",
  expression: "image.expressionAdjust",
  texture: "image.portraitTexture",
} as const;

export type LocalTransformKind = "mirror" | "crop" | "rotate";

export function swapRatio(ratio?: string | null): string | undefined {
  if (!ratio) return undefined;
  const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return match ? `${match[2]}:${match[1]}` : undefined;
}
