import type {
  CanvasNode,
  Connection,
} from "../../domain/models/canvas-document";
import { isImageCanvasNodeType } from "@/lib/canvas-node-types";
import { nodeRenderRect } from "@/lib/canvas-helpers";
import type { CanvasFlowEdge, CanvasFlowNode } from "./canvas-flow-types";

const IMAGE_NODE_DRAG_HANDLE = "[data-canvas-node-drag-handle]";

interface CanvasFlowNodeVariants {
  selected?: CanvasFlowNode;
  unselected?: CanvasFlowNode;
}

interface CanvasFlowEdgeCacheEntry {
  edge: CanvasFlowEdge;
  sourceNode?: CanvasNode;
  targetNode?: CanvasNode;
}

interface CanvasFlowEdgeVariants {
  idle?: CanvasFlowEdgeCacheEntry;
  related?: CanvasFlowEdgeCacheEntry;
  selected?: CanvasFlowEdgeCacheEntry;
  selectedRelated?: CanvasFlowEdgeCacheEntry;
}

// Domain 对象采用不可变更新。以对象身份缓存适配结果，可让 500 节点场景中一次
// 单节点编辑只替换对应 React Flow 节点，避免全部媒体组件重新进入渲染链路。
const nodeVariants = new WeakMap<CanvasNode, CanvasFlowNodeVariants>();
const edgeVariants = new WeakMap<Connection, CanvasFlowEdgeVariants>();

function toCanvasFlowNode(node: CanvasNode, selected: boolean): CanvasFlowNode {
  const variants = nodeVariants.get(node) ?? {};
  const key = selected ? "selected" : "unselected";
  const cached = variants[key];
  if (cached) return cached;

  const flowNode: CanvasFlowNode = {
    id: node.id,
    type: "canvasNode",
    position: { x: node.x, y: node.y },
    data: { node },
    selected,
    draggable: true,
    // 图片、角色和场景节点只允许从主预览卡拖动。输入面板、端口和外置工具栏
    // 均位于该句柄之外，避免第一次点击被节点拖拽手势吞掉。
    dragHandle: isImageCanvasNodeType(node.type) ? IMAGE_NODE_DRAG_HANDLE : undefined,
    connectable: true,
    selectable: true,
    focusable: true,
    ariaLabel: node.title || `${node.type} 节点`,
    style: {
      // 宽幅媒体可能超出名义节点宽度；外壳覆盖真实内容，确保视口裁剪和命中不截断。
      width: Math.max(node.width, node.contentW ?? 0),
      minHeight: Math.max(node.height, node.contentH ?? 0),
      background: "transparent",
      border: 0,
      padding: 0,
    },
  };
  variants[key] = flowNode;
  nodeVariants.set(node, variants);
  return flowNode;
}

function edgeVariantKey(selected: boolean, related: boolean): keyof CanvasFlowEdgeVariants {
  if (selected && related) return "selectedRelated";
  if (selected) return "selected";
  if (related) return "related";
  return "idle";
}

function toCanvasFlowEdge(
  connection: Connection,
  sourceNode: CanvasNode | undefined,
  targetNode: CanvasNode | undefined,
  selected: boolean,
  related: boolean,
): CanvasFlowEdge {
  const variants = edgeVariants.get(connection) ?? {};
  const key = edgeVariantKey(selected, related);
  const cached = variants[key];
  if (cached && cached.sourceNode === sourceNode && cached.targetNode === targetNode) {
    return cached.edge;
  }

  const sourceRect = sourceNode ? nodeRenderRect(sourceNode) : null;
  const targetRect = targetNode ? nodeRenderRect(targetNode) : null;

  const flowEdge: CanvasFlowEdge = {
    id: connection.id,
    type: "canvasEdge",
    source: connection.sourceId,
    target: connection.targetId,
    sourceHandle: connection.sourceOutput || "output",
    targetHandle: connection.targetSlot || "input",
    selected,
    selectable: true,
    focusable: true,
    deletable: false,
    // 当前领域命令未实现端点重连。显式关闭 React Flow 的默认能力，避免用户
    // 拖动端点后受控 edges 原样回写，出现看似可操作但立即回弹的假交互。
    reconnectable: false,
    interactionWidth: 20,
    data: {
      relatedToSelection: related,
      ...(sourceRect ? {
        sourceAnchor: {
          x: sourceRect.x + sourceRect.w,
          y: sourceRect.y + sourceRect.h / 2,
        },
      } : {}),
      ...(targetRect ? {
        targetAnchor: {
          x: targetRect.x,
          y: targetRect.y + targetRect.h / 2,
        },
      } : {}),
    },
  };
  variants[key] = { edge: flowEdge, sourceNode, targetNode };
  edgeVariants.set(connection, variants);
  return flowEdge;
}

export function toCanvasFlowNodes(
  nodes: readonly CanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
): CanvasFlowNode[] {
  return nodes.map((node) => toCanvasFlowNode(node, selectedNodeIds.has(node.id)));
}

export function toCanvasFlowEdges(
  connections: readonly Connection[],
  nodes: readonly CanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
  selectedConnectionId: string | null,
): CanvasFlowEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return connections.map((connection) => {
    const sourceNode = nodesById.get(connection.sourceId);
    const targetNode = nodesById.get(connection.targetId);
    return toCanvasFlowEdge(
      connection,
      sourceNode,
      targetNode,
      selectedConnectionId === connection.id,
      selectedNodeIds.has(connection.sourceId) || selectedNodeIds.has(connection.targetId),
    );
  });
}
