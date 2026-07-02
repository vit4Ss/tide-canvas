"use client";

import { useCallback, useEffect } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Options {
  onEscape?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
}

export function useCanvasKeyboard({ onEscape, onCopy, onPaste }: Options = {}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Also treat contentEditable as typing: the node prompt editor is a
    // contentEditable <div>, and without this guard Delete would remove the very
    // node being edited, Ctrl+A/Z/G would hijack text select/undo/group, etc.
    const t = e.target as HTMLElement | null;
    const isTyping =
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t?.isContentEditable ?? false);
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
    // Ctrl+C 复制选中节点到剪贴板
    if (ctrl && e.key.toLowerCase() === "c" && onCopy) {
      e.preventDefault();
      onCopy();
      return;
    }
    // Ctrl+V 粘贴
    if (ctrl && e.key.toLowerCase() === "v" && onPaste) {
      e.preventDefault();
      onPaste();
      return;
    }
    // Ctrl+G 把当前多选(≥2)创建为分组
    if (ctrl && e.key.toLowerCase() === "g") {
      e.preventDefault();
      const ids = Array.from(store.selectedNodeIds);
      if (ids.length >= 2) store.createGroup(ids);
      return;
    }
    // Delete 删除选中节点或连接
    if (e.key === "Delete") {
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
  }, [onEscape, onCopy, onPaste]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
