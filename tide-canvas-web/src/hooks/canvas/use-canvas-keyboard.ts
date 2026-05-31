"use client";

import { useCallback, useEffect } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Options {
  onEscape?: () => void;
}

export function useCanvasKeyboard({ onEscape }: Options = {}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (isTyping) return;

    const store = useCanvasStore.getState();
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Z 撤销
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      store.undo();
      return;
    }
    // Ctrl+Shift+Z 或 Ctrl+Y 重做
    if ((ctrl && e.shiftKey && e.key.toLowerCase() === "z") || (ctrl && e.key.toLowerCase() === "y")) {
      e.preventDefault();
      store.redo();
      return;
    }
    // Ctrl+A 全选
    if (ctrl && e.key.toLowerCase() === "a") {
      e.preventDefault();
      store.selectAll();
      return;
    }
    // Delete/Backspace 删除选中节点或连接
    if (e.key === "Delete" || e.key === "Backspace") {
      const nodeIds = Array.from(store.selectedNodeIds);
      if (nodeIds.length > 0) {
        e.preventDefault();
        store.removeNodes(nodeIds);
      } else if (store.selectedConnectionId) {
        e.preventDefault();
        store.removeConnection(store.selectedConnectionId);
        store.selectConnection(null);
      }
    }
    // Esc 清除选择 + 关闭菜单
    if (e.key === "Escape") {
      onEscape?.();
      store.clearSelection();
      store.selectConnection(null);
    }
  }, [onEscape]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
