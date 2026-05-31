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
  connectingRef.current = connecting;
  const clearQuickAdd = useCallback(() => setQuickAdd(null), []);
  const transformRef = useRef(transform);
  transformRef.current = transform;

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
    // 端口的世界坐标（左端口或右端口的中点）
    const portWorldX = side === "input" ? node.x : node.x + node.width;
    const portWorldY = node.y + node.height / 2;
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
      const hover = nodes.find((n) =>
        n.id !== c.sourceNodeId &&
        world.x >= n.x && world.x <= n.x + n.width &&
        world.y >= n.y && world.y <= n.y + n.height
      );
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
