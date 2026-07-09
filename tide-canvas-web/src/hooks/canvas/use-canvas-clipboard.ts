"use client";

import { useCallback, useState } from "react";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";

export function useCanvasClipboard() {
  // 选择器订阅，避免订阅整个 store 导致消费组件被无关变更频繁重渲染
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const [clipboard, setClipboard] = useState<CanvasNode | null>(null);

  const copyNode = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setClipboard(node);
    const newNode: CanvasNode = {
      ...node,
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
      ...clipboard,
      id: generateNodeId(),
      x: worldX - clipboard.width / 2,
      y: worldY - clipboard.height / 2,
    };
    addNode(newNode);
    selectNode(newNode.id);
  }, [clipboard, addNode, selectNode]);

  return { clipboard, copyNode, pasteNode, canPaste: !!clipboard };
}
