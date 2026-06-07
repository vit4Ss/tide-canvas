"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

export type PortSide = "input" | "output";

interface ConnectingState {
  sourceNodeId: string;
  sourceSide: PortSide;
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  hoverTargetNodeId: string | null;
}

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
}

/** 连线拖到空白处松手 → 触发的“快捷新建”意图 */
export interface QuickAddState {
  sourceNodeId: string;
  sourceSide: PortSide;
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
}

export function useCanvasConnection({ containerRef }: Options) {
  const transform = useCanvasStore((s) => s.transform);
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const connectingRef = useRef<ConnectingState | null>(null);
  const clearQuickAdd = useCallback(() => setQuickAdd(null), []);
  const transformRef = useRef(transform);
  // 渲染期不直接写 ref：用 effect 把最新值镜像进 ref，供 window 事件回调（onMove/onUp）
  // 与 screenToWorld 异步读取最新值（满足 react-hooks/refs；事件总在 commit 后触发，时序安全）。
  useEffect(() => {
    connectingRef.current = connecting;
    transformRef.current = transform;
  });

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = transformRef.current;
    return {
      x: (sx - rect.left - t.x) / t.k,
      y: (sy - rect.top - t.y) / t.k,
    };
  }, [containerRef]);

  /** 从节点端口开始拖拽 */
  const startConnection = useCallback((nodeId: string, side: PortSide, clientX: number, clientY: number) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // 端口的世界坐标：卡片左/右缘的垂直中点（与连线端点、端口“+”图标一致）
    const cw = node.contentW ?? node.width;
    const ch = node.contentH ?? node.height;
    const portWorldX = side === "input" ? node.x + (node.width - cw) / 2 : node.x + (node.width + cw) / 2;
    const portWorldY = node.y + ch / 2;
    const cur = screenToWorld(clientX, clientY);
    setConnecting({
      sourceNodeId: nodeId,
      sourceSide: side,
      startWorldX: portWorldX,
      startWorldY: portWorldY,
      currentWorldX: cur.x,
      currentWorldY: cur.y,
      hoverTargetNodeId: null,
    });
  }, [screenToWorld]);

  /** 监听全局 mousemove/mouseup 完成拖拽流程 */
  useEffect(() => {
    if (!connecting) return;

    const onMove = (e: MouseEvent) => {
      const c = connectingRef.current;
      if (!c) return;
      const world = screenToWorld(e.clientX, e.clientY);
      // 检测是否悬停在某节点上（用于高亮目标）
      const nodes = useCanvasStore.getState().nodes;
      const hover = nodes.find((n) => {
        if (n.id === c.sourceNodeId) return false;
        // 命中区按卡片实际渲染区域（竖图卡片比名义框窄/高，更精确）
        const cw = n.contentW ?? n.width;
        const ch = n.contentH ?? n.height;
        const left = n.x + (n.width - cw) / 2;
        return world.x >= left && world.x <= left + cw && world.y >= n.y && world.y <= n.y + ch;
      });
      setConnecting({ ...c, currentWorldX: world.x, currentWorldY: world.y, hoverTargetNodeId: hover?.id ?? null });
    };

    const onUp = (e: MouseEvent) => {
      const c = connectingRef.current;
      if (!c) return;
      if (c.hoverTargetNodeId) {
        // 落在某节点上 → 创建连接
        const store = useCanvasStore.getState();
        const sourceId = c.sourceSide === "output" ? c.sourceNodeId : c.hoverTargetNodeId;
        const targetId = c.sourceSide === "output" ? c.hoverTargetNodeId : c.sourceNodeId;
        // 避免重复连接
        const exists = store.connections.some((conn) => conn.sourceId === sourceId && conn.targetId === targetId);
        if (!exists && sourceId !== targetId) {
          store.addConnection({
            id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sourceId,
            targetId,
          });
        }
      } else {
        // 落在空白处且确实拖动过 → 弹出快捷新建菜单（新建节点并自动连线）
        const dist = Math.hypot(c.currentWorldX - c.startWorldX, c.currentWorldY - c.startWorldY);
        if (dist > 24) {
          setQuickAdd({
            sourceNodeId: c.sourceNodeId,
            sourceSide: c.sourceSide,
            clientX: e.clientX,
            clientY: e.clientY,
            worldX: c.currentWorldX,
            worldY: c.currentWorldY,
          });
        }
      }
      setConnecting(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [connecting, screenToWorld]);

  return {
    connecting,
    startConnection,
    isConnecting: !!connecting,
    hoverTargetNodeId: connecting?.hoverTargetNodeId ?? null,
    quickAdd,
    clearQuickAdd,
  };
}
