"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // gridSnap 经 ref 读取:拖拽会话的 window 监听在 mousedown 时绑定,
  // 直接闭包捕获会在会话中途切换吸附时用到旧值(effect 镜像,与 connection hook 同法)
  const gridSnapRef = useRef(gridSnap);
  useEffect(() => {
    gridSnapRef.current = gridSnap;
  }, [gridSnap]);
  // 拖拽会话清理函数,卸载时兜底解绑
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const moveTo = useCallback((clientX: number, clientY: number) => {
    const p = pendingRef.current;
    if (!p) return;

    // 未达到阈值前不激活拖动（避免单击时 UI 闪烁）
    if (!p.moved) {
      const dx = Math.abs(clientX - p.startClientX);
      const dy = Math.abs(clientY - p.startClientY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      p.moved = true;
      setDraggingNodeId(p.id);
    }

    // 首帧记录历史 → 移动可撤销
    if (!p.historyRecorded) {
      useCanvasStore.getState().pushHistory();
      p.historyRecorded = true;
    }

    const st = useCanvasStore.getState();
    // 拖拽中若节点已不存在(拖动时按了 Ctrl+Z 撤销掉新建/成组等),
    // 继续用过期 initials 覆写位置会让撤销"失效",直接取消本次拖拽
    if (!p.initials.every((init) => st.nodes.some((n) => n.id === init.id))) {
      pendingRef.current = null;
      setDraggingNodeId(null);
      dragCleanupRef.current?.();
      return;
    }

    const k = st.transform.k;
    const dx = (clientX - p.startClientX) / k;
    const dy = (clientY - p.startClientY) / k;
    const snap = gridSnapRef.current;
    const updates = p.initials.map((init) => {
      let x = init.x + dx;
      let y = init.y + dy;
      if (snap) {
        x = Math.round(x / GRID_SIZE) * GRID_SIZE;
        y = Math.round(y / GRID_SIZE) * GRID_SIZE;
      }
      return { id: init.id, x, y };
    });
    st.updateNodePositions(updates);
  }, []);

  const finishDrag = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setDraggingNodeId(null);
    // 在多选集合上点了一下但没拖动 → 回退为单选该节点
    if (p && !p.moved && p.pendingSingleSelect) {
      useCanvasStore.getState().selectNode(p.pendingSingleSelect);
    }
  }, []);

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

    // window 级监听:拖拽期间指针会扫过底部工具坞/小地图等叠在画布上的兄弟
    // 浮层,此前依赖 container 的 mousemove + onMouseLeave 兜底,一进浮层
    // 就触发 mouseleave 把拖拽半路打断(框选/连线早已用 window 监听,对齐)。
    const onWinMove = (ev: MouseEvent) => moveTo(ev.clientX, ev.clientY);
    const cleanup = () => {
      window.removeEventListener("mousemove", onWinMove);
      window.removeEventListener("mouseup", onWinUp);
      dragCleanupRef.current = null;
    };
    const onWinUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return; // 拖拽中点右键不结束左键拖拽
      cleanup();
      finishDrag();
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onWinMove);
    window.addEventListener("mouseup", onWinUp);
  }, [moveTo, finishDrag]);

  return { onNodeMouseDown, draggingNodeId };
}
