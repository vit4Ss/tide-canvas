"use client";

import { useCallback, useRef, useState } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Options {
  gridSnap: boolean;
}

interface PendingDrag {
  id: string;
  startClientX: number;
  startClientY: number;
  // 拖拽开始时整组待移动节点的初始位置（支持多选整体拖动）
  initials: { id: string; x: number; y: number }[];
  // 按下时本节点已在多选集合中 → 记下，未实际拖动时 mouseup 回退为单选
  pendingSingleSelect: string | null;
  historyRecorded: boolean;
  moved: boolean;
}

// 拖动激活阈值（像素）— 超过此距离才认为是拖动而非单击
const DRAG_THRESHOLD = 4;
const GRID_SIZE = 20;

/**
 * 节点拖拽 + 选择语义合一。
 * - 普通点击未选中节点：单选并准备拖动
 * - 点击已在多选集合中的节点：保持整组，拖动时整组移动；未拖动则 mouseup 回退单选
 * - Ctrl/Cmd/Shift 点击：切换多选，不进入拖拽
 * - 拖拽首帧记录一次历史，使移动可被 Ctrl+Z 撤销
 */
export function useCanvasNodeDrag({ gridSnap }: Options) {
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const pendingRef = useRef<PendingDrag | null>(null);

  const onNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return; // 仅左键拖动，右键交给上下文菜单
    e.stopPropagation();
    const store = useCanvasStore.getState();

    // 修饰键 → 仅切换选择，不拖动
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      store.toggleSelectNode(nodeId);
      return;
    }

    const selected = store.selectedNodeIds;
    let pendingSingleSelect: string | null = null;
    if (!selected.has(nodeId)) {
      store.selectNode(nodeId); // 选中新节点（单选）
    } else if (selected.size > 1) {
      pendingSingleSelect = nodeId; // 已是多选成员：先不动选区，允许整组拖动
    }

    // 整组 = 当前选区（可能刚被设为单选）
    const sel = useCanvasStore.getState().selectedNodeIds;
    const groupIds = sel.has(nodeId) ? sel : new Set([nodeId]);
    const initials = useCanvasStore
      .getState()
      .nodes.filter((n) => groupIds.has(n.id))
      .map((n) => ({ id: n.id, x: n.x, y: n.y }));

    pendingRef.current = {
      id: nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initials,
      pendingSingleSelect,
      historyRecorded: false,
      moved: false,
    };
  }, []);

  const onMove = useCallback((e: React.MouseEvent) => {
    const p = pendingRef.current;
    if (!p) return;

    // 未达到阈值前不激活拖动（避免单击时 UI 闪烁）
    if (!p.moved) {
      const dx = Math.abs(e.clientX - p.startClientX);
      const dy = Math.abs(e.clientY - p.startClientY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      p.moved = true;
      setDraggingNodeId(p.id);
    }

    // 首帧记录历史 → 移动可撤销
    if (!p.historyRecorded) {
      useCanvasStore.getState().pushHistory();
      p.historyRecorded = true;
    }

    const k = useCanvasStore.getState().transform.k;
    const dx = (e.clientX - p.startClientX) / k;
    const dy = (e.clientY - p.startClientY) / k;
    const updates = p.initials.map((init) => {
      let x = init.x + dx;
      let y = init.y + dy;
      if (gridSnap) {
        x = Math.round(x / GRID_SIZE) * GRID_SIZE;
        y = Math.round(y / GRID_SIZE) * GRID_SIZE;
      }
      return { id: init.id, x, y };
    });
    useCanvasStore.getState().updateNodePositions(updates);
  }, [gridSnap]);

  const endDrag = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setDraggingNodeId(null);
    // 在多选集合上点了一下但没拖动 → 回退为单选该节点
    if (p && !p.moved && p.pendingSingleSelect) {
      useCanvasStore.getState().selectNode(p.pendingSingleSelect);
    }
  }, []);

  return { onNodeMouseDown, onMove, endDrag, draggingNodeId };
}
