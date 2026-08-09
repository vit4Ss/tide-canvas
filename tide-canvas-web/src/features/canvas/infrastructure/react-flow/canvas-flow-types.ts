import type { Edge, Node } from "@xyflow/react";
import type { CanvasNode } from "../../domain/models/canvas-document";

export interface CanvasFlowNodeData extends Record<string, unknown> {
  node: CanvasNode;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, "canvasNode">;

export interface CanvasFlowEdgeData extends Record<string, unknown> {
  relatedToSelection: boolean;
}

export type CanvasFlowEdge = Edge<CanvasFlowEdgeData, "canvasEdge">;
