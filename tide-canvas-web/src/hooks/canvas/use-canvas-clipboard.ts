"use client";

import { useCallback, useState } from "react";
import { useCanvasStore, generateNodeId, reviveNode, type CanvasNode } from "@/stores/use-canvas-store";

export function useCanvasClipboard() {
  // 选择器订阅，避免订阅整个 store 导致消费组件被无关变更频繁重渲染
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const [clipboard, setClipboard] = useState<CanvasNode | null>(null);

  const copyNode = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setClipboard(node);
    // reviveNode:克隆"生成中/上传中"的节点必须清洗瞬态状态——轮询/上传器
    // 只指向原节点,克隆体带着 generating 会永久转圈且按钮永久禁用
    const newNode: CanvasNode = {
      ...reviveNode(node),
      id: generateNodeId(),
      x: node.x + 30,
      y: node.y + 30,
    };
    addNode(newNode);
    selectNode(newNode.id);
  }, [addNode, selectNode]);

  const pasteNode = useCallback((worldX: number, worldY: number) => {
    if (!clipboard) return;
    const newNode: CanvasNode = {
      ...reviveNode(clipboard),
      id: generateNodeId(),
      x: worldX - clipboard.width / 2,
      y: worldY - clipboard.height / 2,
    };
    addNode(newNode);
    selectNode(newNode.id);
  }, [clipboard, addNode, selectNode]);

  return { clipboard, copyNode, pasteNode, canPaste: !!clipboard };
}
