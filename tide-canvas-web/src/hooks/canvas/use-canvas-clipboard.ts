"use client";

import { useCallback, useState } from "react";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";

export function useCanvasClipboard() {
  // 选择器订阅，避免订阅整个 store 导致消费组件被无关变更频繁重渲染
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const [clipboard, setClipboard] = useState<CanvasNode | null>(null);

  // copyNode is copy-only: it stashes the node so a subsequent paste (⌘V or the
  // 粘贴 menu item) creates the copy. It no longer duplicates immediately, which
  // made the ⌘C-labeled "复制节点" surprising and the ⌘C/⌘V shortcuts meaningless.
  const copyNode = useCallback((nodeId: string) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setClipboard(node);
  }, []);

  // pasteNode drops the clipboard node at the given world point (centered), or —
  // when no point is given (⌘V) — at a small offset from the copied node so the
  // paste is visible and doesn't overlap the original exactly.
  const pasteNode = useCallback((worldX?: number, worldY?: number) => {
    if (!clipboard) return;
    const x = worldX !== undefined ? worldX - clipboard.width / 2 : clipboard.x + 40;
    const y = worldY !== undefined ? worldY - clipboard.height / 2 : clipboard.y + 40;
    const newNode: CanvasNode = {
      ...clipboard,
      id: generateNodeId(),
      x,
      y,
    };
    addNode(newNode);
    selectNode(newNode.id);
  }, [clipboard, addNode, selectNode]);

  return { clipboard, copyNode, pasteNode, canPaste: !!clipboard };
}
