"use client";

import { useCallback, useState } from "react";
import { useCanvasStore, generateNodeId, reviveNode } from "@/stores/use-canvas-store";
import {
  captureCanvasNodeClipboard,
  materializeCanvasNodeClipboard,
  type CanvasNodeClipboardSnapshot,
} from "@/lib/canvas-clipboard";

export function useCanvasClipboard() {
  // 选择器订阅，避免订阅整个 store 导致消费组件被无关变更频繁重渲染
  const addNodesAndConnections = useCanvasStore((s) => s.addNodesAndConnections);
  const [clipboard, setClipboard] = useState<CanvasNodeClipboardSnapshot | null>(null);

  const copyNode = useCallback((nodeId: string) => {
    const state = useCanvasStore.getState();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // Copy stores a safe snapshot only. Duplication happens on paste, matching
    // the context-menu labels and the Cmd/Ctrl+C, Cmd/Ctrl+V contract.
    setClipboard(captureCanvasNodeClipboard(reviveNode(node), state.connections));
  }, []);

  const pasteNode = useCallback((worldX?: number, worldY?: number) => {
    if (!clipboard) return;
    const state = useCanvasStore.getState();
    const next = materializeCanvasNodeClipboard({
      snapshot: clipboard,
      newNodeId: generateNodeId(),
      availableNodeIds: new Set(state.nodes.map((node) => node.id)),
      worldX,
      worldY,
    });
    addNodesAndConnections([next.node], next.connections, next.node.id);
  }, [clipboard, addNodesAndConnections]);

  return { clipboard, copyNode, pasteNode, canPaste: !!clipboard };
}
