"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";

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
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const connectingRef = useRef<ConnectingState | null>(null);
  const clearQuickAdd = useCallback(() => setQuickAdd(null), []);
  // 渲染期不直接写 ref：用 effect 把最新值镜像进 ref，供 window 事件回调（onMove/onUp）
  // 异步读取最新值（满足 react-hooks/refs；事件总在 commit 后触发，时序安全）。
  useEffect(() => {
    connectingRef.current = connecting;
  });

  // transform 不做渲染订阅（避免宿主 CanvasView 每帧重渲染），事件时按需读 store
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = useCanvasViewStore.getState().transform;
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
  // 只以「是否在拖线」为开关挂/卸监听:依赖整个 connecting 对象会在每次
  // mousemove 更新 state 后重绑 window 监听,白白抖动
  const isDraggingLink = !!connecting;
  useEffect(() => {
    if (!isDraggingLink) return;

    // 命中检测:按卡片实际渲染区域外扩一圈容差,拖到卡片边缘附近松手也算命中,
    // 避免差几像素落空弹出快捷新建
    const HIT_MARGIN = 28;
    const hitTest = (world: { x: number; y: number }, sourceNodeId: string) => {
      const nodes = useCanvasStore.getState().nodes;
      return nodes.find((n) => {
        if (n.id === sourceNodeId) return false;
        const cw = n.contentW ?? n.width;
        const ch = n.contentH ?? n.height;
        const left = n.x + (n.width - cw) / 2;
        return world.x >= left - HIT_MARGIN && world.x <= left + cw + HIT_MARGIN
          && world.y >= n.y - HIT_MARGIN && world.y <= n.y + ch + HIT_MARGIN;
      });
    };

    // rAF 合帧:临时连线是 React state,直接逐 mousemove set 会让画布树按事件频率重渲染
    let raf = 0;
    let lastEv: MouseEvent | null = null;
    const applyMove = (e: MouseEvent) => {
      const c = connectingRef.current;
      if (!c) return;
      const world = screenToWorld(e.clientX, e.clientY);
      const hover = hitTest(world, c.sourceNodeId);
      setConnecting({ ...c, currentWorldX: world.x, currentWorldY: world.y, hoverTargetNodeId: hover?.id ?? null });
    };
    const onMove = (e: MouseEvent) => {
      lastEv = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (lastEv) applyMove(lastEv);
      });
    };

    const onUp = (e: MouseEvent) => {
      const c = connectingRef.current;
      if (!c) return;
      // 右键/中键释放视为取消:否则拖线途中点右键会按落点提交连接或弹出
      // 快捷新建,与同时弹出的右键菜单叠在一起
      if (e.button !== 0) {
        setConnecting(null);
        return;
      }
      // 松手按事件坐标现算落点与命中:state 经 rAF 合帧,可能滞后不到一帧
      const world = screenToWorld(e.clientX, e.clientY);
      const hover = hitTest(world, c.sourceNodeId);
      if (hover) {
        // 落在某节点上 → 创建连接
        const store = useCanvasStore.getState();
        const sourceId = c.sourceSide === "output" ? c.sourceNodeId : hover.id;
        const targetId = c.sourceSide === "output" ? hover.id : c.sourceNodeId;
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
        const dist = Math.hypot(world.x - c.startWorldX, world.y - c.startWorldY);
        if (dist > 24) {
          setQuickAdd({
            sourceNodeId: c.sourceNodeId,
            sourceSide: c.sourceSide,
            clientX: e.clientX,
            clientY: e.clientY,
            worldX: world.x,
            worldY: world.y,
          });
        }
      }
      setConnecting(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingLink, screenToWorld]);

  return {
    connecting,
    startConnection,
    isConnecting: !!connecting,
    hoverTargetNodeId: connecting?.hoverTargetNodeId ?? null,
    quickAdd,
    clearQuickAdd,
  };
}
