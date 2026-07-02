import { AlignLeft, AudioLines, Clapperboard, Image as ImageIcon, Layers, Scissors, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 中文注释：节点类型与图标在这里统一映射，新增节点时只需要补充这一处。
const NODE_TYPE_ICONS: Record<string, LucideIcon> = {
  text: AlignLeft,
  image: ImageIcon,
  video: Video,
  video_compose: Scissors,
  scene_3d: Layers,
  audio: AudioLines,
  script: Clapperboard,
};

export function getNodeIcon(type: string): LucideIcon {
  return NODE_TYPE_ICONS[type] ?? AlignLeft;
}
