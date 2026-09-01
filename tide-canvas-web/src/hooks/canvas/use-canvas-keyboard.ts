"use client";

import { useCallback, useEffect } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Options {
  onEscape?: () => void;
  onCopyNode?: (nodeId: string) => void;
  onPaste?: () => void;
  canPaste?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return !!target.closest('[contenteditable="true"], [role="textbox"]');
}

export function useCanvasKeyboard({ onEscape, onCopyNode, onPaste, canPaste = false }: Options = {}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    // 画布级弹窗(标注/资产库/放大编辑等)打开时键盘归弹窗:弹窗内点击空白后
    // 焦点常落在 body,isEditableTarget 挡不住,快捷键会穿透误伤画布
    // (Ctrl+Z 双撤销、Delete 删掉弹窗背后正在编辑的节点、Esc 清选中)。
    if (document.querySelector("[data-canvas-modal]")) return;

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
    if (ctrl && e.key.toLowerCase() === "c") {
      if (store.selectedNodeId && onCopyNode) {
        e.preventDefault();
        onCopyNode(store.selectedNodeId);
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "v") {
      if (canPaste && onPaste) {
        e.preventDefault();
        onPaste();
      }
      return;
    }
    // Ctrl+G 把当前多选(≥2)创建为分组
    if (ctrl && e.key.toLowerCase() === "g") {
      e.preventDefault();
      const ids = Array.from(store.selectedNodeIds);
      if (ids.length >= 2) store.createGroup(ids);
      return;
    }
    // Delete/Backspace 删除选中节点或连接(Mac 主键盘的删除键上报 Backspace;
    // 输入框场景已被顶部 isEditableTarget 挡掉,不会误删)
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
  }, [canPaste, onCopyNode, onEscape, onPaste]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
