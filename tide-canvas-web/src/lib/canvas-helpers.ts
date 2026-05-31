import { generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";

export const NODE_TYPE_TITLES: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  video_compose: "视频合成",
  scene_3d: "导演台",
  audio: "音频",
  script: "脚本",
};

const NODE_TYPE_SIZES: Record<string, { width: number; height: number }> = {
  // 等比节点高度按默认比例的卡片高度设置，使连接线/缩略图对齐实际渲染
  image: { width: 480, height: 270 },
  video: { width: 720, height: 405 },
  video_compose: { width: 720, height: 580 },
  scene_3d: { width: 720, height: 360 },
  text: { width: 360, height: 200 },
  audio: { width: 360, height: 200 },
  script: { width: 360, height: 200 },
};

export function getNodeTitle(type: string): string {
  return NODE_TYPE_TITLES[type] || type;
}

export function getNodeSize(type: string): { width: number; height: number } {
  return NODE_TYPE_SIZES[type] || { width: 240, height: 160 };
}

export function createNode(type: string, worldX: number, worldY: number, existingNodes: CanvasNode[] = []): CanvasNode {
  const { width, height } = getNodeSize(type);
  const sameTypeCount = existingNodes.filter((n) => n.type === type).length;
  const baseTitle = getNodeTitle(type);
  const title = sameTypeCount === 0 ? `${baseTitle}节点` : `${baseTitle}节点 ${sameTypeCount + 1}`;
  return {
    id: generateNodeId(),
    type,
    x: worldX - width / 2,
    y: worldY - height / 2,
    width,
    height,
    title,
    status: "idle",
  };
}

export function autoArrangeNodes(nodes: CanvasNode[], updateNode: (id: string, data: Partial<CanvasNode>) => void) {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const gap = 40;
  nodes.forEach((node, i) => {
    const x = (i % cols) * (node.width + gap);
    const y = Math.floor(i / cols) * (node.height + gap + 60);
    updateNode(node.id, { x, y });
  });
}
