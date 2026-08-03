import {
  AlignLeft,
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  Layers,
  Mountain,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import type {
  CanvasNodeConfigVO,
  CanvasNodeFeatureKey,
  CanvasNodeRenderer,
  CanvasNodeTypeConfigVO,
} from "@/types/canvas-node-config";

export const CANVAS_NODE_CONFIG_VERSION = 5;

export const PORTRAIT_NODE_DEFAULT_FEATURES: CanvasNodeFeatureKey[] = [
  "image.subjectTurnaround",
  "image.subjectCloseup",
  "image.expressionGrid",
  "image.makeupAdjust",
  "image.expressionAdjust",
  "image.portraitTexture",
];

export const IMAGE_NODE_DEFAULT_FEATURES: CanvasNodeFeatureKey[] = [
  "tool.upscale",
  "image.crop",
  "image.rotate",
  "image.panorama",
  "image.panoramaCapture",
  "image.panoramaCaptureGrid",
  "image.panoramaGuide",
  "image.panoramaReset",
  "image.multiAngle",
  "image.relightPanel",
  "image.gridGenerate",
  "image.gridSplit",
  "image.mirror",
  "media.replace",
  "media.download",
  "media.preview",
  "skill.launcher",
];

export const VIDEO_NODE_FEATURES: CanvasNodeFeatureKey[] = [
  "media.replace",
  "media.download",
  "media.preview",
  "skill.launcher",
];

const IMAGE_RENDERER_FEATURES: CanvasNodeFeatureKey[] = [
  ...PORTRAIT_NODE_DEFAULT_FEATURES,
  ...IMAGE_NODE_DEFAULT_FEATURES,
];

const KNOWN_FEATURES = new Set<CanvasNodeFeatureKey>([
  ...IMAGE_RENDERER_FEATURES,
  ...VIDEO_NODE_FEATURES,
]);

const RENDERER_FEATURES: Record<CanvasNodeRenderer, ReadonlySet<CanvasNodeFeatureKey>> = {
  image: new Set(IMAGE_RENDERER_FEATURES),
  video: new Set(VIDEO_NODE_FEATURES),
  scene_3d: new Set(["skill.launcher"]),
  text: new Set(["skill.launcher"]),
  audio: new Set(["skill.launcher"]),
  script: new Set(["skill.launcher"]),
};

/**
 * 前端 renderer/icon 注册表。即使接口遭到手工写入，也只能实例化这里已有的
 * React 节点与图标，后台不能凭一个字符串创造新的运行时代码。
 */
const NODE_PRESENTATION: Record<
  string,
  {
    title: string;
    description: string;
    renderer: CanvasNodeRenderer;
    iconKey: string;
    icon: LucideIcon;
  }
> = {
  character: {
    title: "角色",
    description: "外貌、服装与姿态设定",
    renderer: "image",
    iconKey: "user-round",
    icon: UserRound,
  },
  scene: {
    title: "场景",
    description: "环境、光线与氛围设定",
    renderer: "image",
    iconKey: "mountain",
    icon: Mountain,
  },
  scene_3d: {
    title: "3D 导演台",
    description: "角色动作与空间编排",
    renderer: "scene_3d",
    iconKey: "layers",
    icon: Layers,
  },
  text: {
    title: "文本",
    description: "提示词、脚本说明",
    renderer: "text",
    iconKey: "align-left",
    icon: AlignLeft,
  },
  image: {
    title: "图片",
    description: "图像生成、参考图编辑",
    renderer: "image",
    iconKey: "image",
    icon: ImageIcon,
  },
  video: {
    title: "视频",
    description: "视频生成、镜头创作",
    renderer: "video",
    iconKey: "video",
    icon: Video,
  },
  audio: {
    title: "音频",
    description: "音色、配乐与旁白",
    renderer: "audio",
    iconKey: "audio-lines",
    icon: AudioLines,
  },
  script: {
    title: "脚本",
    description: "分镜和内容结构",
    renderer: "script",
    iconKey: "clapperboard",
    icon: Clapperboard,
  },
};

const DEFAULT_ORDER = [
  "character",
  "scene",
  "scene_3d",
  "text",
  "image",
  "video",
  "audio",
  "script",
];

function defaultFeatures(renderer: CanvasNodeRenderer, nodeType: string): CanvasNodeFeatureKey[] {
  if (nodeType === "character") return [...PORTRAIT_NODE_DEFAULT_FEATURES, ...IMAGE_NODE_DEFAULT_FEATURES];
  if (renderer === "image") return [...IMAGE_NODE_DEFAULT_FEATURES];
  if (renderer === "video") return [...VIDEO_NODE_FEATURES];
  return ["skill.launcher"];
}

function makeDefaults(): CanvasNodeTypeConfigVO[] {
  return DEFAULT_ORDER.map((key, index) => {
    const item = NODE_PRESENTATION[key];
    return {
      key,
      title: item.title,
      description: item.description,
      renderer: item.renderer,
      icon: item.iconKey,
      enabled: true,
      sortOrder: index,
      features: defaultFeatures(item.renderer, key),
    };
  });
}

export function defaultCanvasNodeConfig(): CanvasNodeConfigVO {
  return { version: CANVAS_NODE_CONFIG_VERSION, nodeTypes: makeDefaults() };
}

export function canvasNodeIcon(type: string): LucideIcon {
  return NODE_PRESENTATION[type]?.icon ?? ImageIcon;
}

export function isCanvasNodeFeatureKey(value: unknown): value is CanvasNodeFeatureKey {
  return typeof value === "string" && KNOWN_FEATURES.has(value as CanvasNodeFeatureKey);
}

/**
 * 把接口结果合并到代码目录。合法的显式空 features 会原样保留；请求失败或
 * schema 版本不识别时调用方应直接使用 defaultCanvasNodeConfig()。
 */
export function normalizeCanvasNodeConfig(value: unknown): CanvasNodeConfigVO | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; nodeTypes?: unknown };
  if (raw.version !== CANVAS_NODE_CONFIG_VERSION || !Array.isArray(raw.nodeTypes)) return null;

  const remoteByKey = new Map<string, Record<string, unknown>>();
  for (const candidate of raw.nodeTypes) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (typeof row.key === "string" && NODE_PRESENTATION[row.key]) remoteByKey.set(row.key, row);
  }

  const nodeTypes = makeDefaults().map((fallback) => {
    const remote = remoteByKey.get(fallback.key);
    if (!remote) return fallback;
    const supported = RENDERER_FEATURES[fallback.renderer];
    const features = Array.isArray(remote.features)
      ? remote.features.filter(
          (feature, index, list): feature is CanvasNodeFeatureKey =>
            isCanvasNodeFeatureKey(feature) &&
            supported.has(feature) &&
            list.indexOf(feature) === index,
        )
      : fallback.features;

    return {
      ...fallback,
      title:
        typeof remote.title === "string" && remote.title.trim()
          ? remote.title.trim()
          : fallback.title,
      description:
        typeof remote.description === "string"
          ? remote.description.trim()
          : fallback.description,
      enabled: typeof remote.enabled === "boolean" ? remote.enabled : fallback.enabled,
      sortOrder:
        typeof remote.sortOrder === "number" && Number.isFinite(remote.sortOrder)
          ? remote.sortOrder
          : fallback.sortOrder,
      features,
    };
  });

  nodeTypes.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return { version: CANVAS_NODE_CONFIG_VERSION, nodeTypes };
}
