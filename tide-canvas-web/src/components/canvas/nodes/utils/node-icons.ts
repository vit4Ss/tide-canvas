import { AlignLeft, AudioLines, Box, Clapperboard, Image as ImageIcon, Layers, Mountain, Scissors, UserRound, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";

// 中文注释：节点类型与图标在这里统一映射，新增节点时只需要补充这一处。
const NODE_TYPE_ICONS: Record<string, LucideIcon> = {
  [CHARACTER_NODE_TYPE]: UserRound,
  [SCENE_NODE_TYPE]: Mountain,
  text: AlignLeft,
  image: ImageIcon,
  video: Video,
  video_compose: Scissors,
  "3d": Box,
  scene_3d: Layers,
  audio: AudioLines,
  script: Clapperboard,
};

export function getNodeIcon(type: string): LucideIcon {
  return NODE_TYPE_ICONS[type] ?? AlignLeft;
}
