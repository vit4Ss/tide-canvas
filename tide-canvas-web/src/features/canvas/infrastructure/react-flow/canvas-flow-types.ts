import type { Edge, Node } from "@xyflow/react";
import type { CanvasNode } from "../../domain/models/canvas-document";

export interface CanvasFlowNodeData extends Record<string, unknown> {
  node: CanvasNode;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasNode">;

export interface CanvasFlowEdgeData extends Record<string, unknown> {
  relatedToSelection: boolean;
  /** 可见曲线锚在卡片边框；React Flow Handle 只保留连接手势命中能力。 */
  sourceAnchor?: { x: number; y: number };
  targetAnchor?: { x: number; y: number };
}

export type CanvasFlowEdge = Edge<CanvasFlowEdgeData, "canvasEdge">;
