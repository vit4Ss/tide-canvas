import type { MouseEvent } from "react";
import type { CanvasNode } from "@/stores/use-canvas-store";

// 中文注释：集中定义所有画布节点共享的外部属性，避免每个节点文件重复维护同一套拖拽与连线入参。
export interface CanvasNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, event: MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}
