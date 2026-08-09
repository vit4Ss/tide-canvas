import type {
  CanvasNode,
  Connection,
} from "../../domain/models/canvas-document";
import type { CanvasFlowEdge, CanvasFlowNode } from "./canvas-flow-types";

interface CanvasFlowNodeVariants {
  selected?: CanvasFlowNode;
  unselected?: CanvasFlowNode;
}

interface CanvasFlowEdgeVariants {
  idle?: CanvasFlowEdge;
  related?: CanvasFlowEdge;
  selected?: CanvasFlowEdge;
  selectedRelated?: CanvasFlowEdge;
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
  selected: boolean,
  related: boolean,
): CanvasFlowEdge {
  const variants = edgeVariants.get(connection) ?? {};
  const key = edgeVariantKey(selected, related);
  const cached = variants[key];
  if (cached) return cached;

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
    interactionWidth: 20,
    data: { relatedToSelection: related },
  };
  variants[key] = flowEdge;
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
  selectedNodeIds: ReadonlySet<string>,
  selectedConnectionId: string | null,
): CanvasFlowEdge[] {
  return connections.map((connection) => toCanvasFlowEdge(
    connection,
    selectedConnectionId === connection.id,
    selectedNodeIds.has(connection.sourceId) || selectedNodeIds.has(connection.targetId),
  ));
}
