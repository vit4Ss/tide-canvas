"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { nodeRenderRect } from "@/lib/canvas-helpers";

interface UsePanZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useCanvasPanZoom({ containerRef }: UsePanZoomOptions) {
  // 选择器订阅：仅 transform 变化时重渲染消费者，避免任意 store 变更都触发全画布重渲染
  const transform = useCanvasStore((s) => s.transform);
  const setTransform = useCanvasStore((s) => s.setTransform);
  const [isPanning, setIsPanning] = useState(false);

  // 用 ref 持有最新 transform，避免 effect 重绑事件 / 回调因 transform 变化频繁重建
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

  // 原生 wheel 事件 + passive:false，确保 preventDefault 生效
  // 阻止浏览器的 Ctrl+滚轮缩放页面
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = transformRef.current;
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newK = Math.min(Math.max(t.k * delta, 0.1), 5);
        setTransform({
          x: mx - (mx - t.x) * (newK / t.k),
          y: my - (my - t.y) * (newK / t.k),
          k: newK,
        });
      } else {
        setTransform({
          ...t,
          x: t.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: t.y - (e.shiftKey ? 0 : e.deltaY),
        });
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, setTransform]);

  // 平移会话的清理函数:组件卸载时兜底解绑(拖拽中途离开画布不残留监听)
  const panCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { panCleanupRef.current?.(); }, []);

  // 平移改用 window 级监听:底部工具坞/小地图/助手面板都是画布容器的兄弟浮层,
  // 靠 container 的 mousemove + onMouseLeave 兜底的话,指针一扫过浮层或冲出
  // 窗口就触发 mouseleave → 平移半路被丢(框选/连线早已用 window 监听,对齐)。
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!(target === containerRef.current || target.dataset.canvas)) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault(); // 阻止中键默认的自动滚动图标
    const button = e.button;
    const start = { x: e.clientX - transformRef.current.x, y: e.clientY - transformRef.current.y };
    setIsPanning(true);

    const onMove = (ev: MouseEvent) => {
      setTransform({ ...transformRef.current, x: ev.clientX - start.x, y: ev.clientY - start.y });
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsPanning(false);
      panCleanupRef.current = null;
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== button) return; // 只有发起平移的那个键释放才结束
      cleanup();
    };
    panCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [containerRef, setTransform]);

  const zoomAtCenter = useCallback((factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const newK = Math.min(Math.max(transform.k * factor, 0.1), 5);
    setTransform({
      x: mx - (mx - transform.x) * (newK / transform.k),
      y: my - (my - transform.y) * (newK / transform.k),
      k: newK,
    });
  }, [containerRef, transform, setTransform]);

  const zoomIn = useCallback(() => zoomAtCenter(1.2), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter(1 / 1.2), [zoomAtCenter]);
  const zoomReset = useCallback(() => setTransform({ x: 0, y: 0, k: 1 }), [setTransform]);

  // 缩放到适应全部节点（无节点时回到原点）
  const fitView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nodes = useCanvasStore.getState().nodes;
    if (nodes.length === 0) {
      setTransform({ x: 0, y: 0, k: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      // 实际渲染矩形:名义 height 会让「适应视图」把高卡片的下半截裁出视口
      const r = nodeRenderRect(n);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    });
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const margin = 100;
    const k = Math.min(
      Math.max(Math.min((rect.width - margin) / contentW, (rect.height - margin) / contentH), 0.1),
      1.5
    );
    setTransform({
      x: (rect.width - contentW * k) / 2 - minX * k,
      y: (rect.height - contentH * k) / 2 - minY * k,
      k,
    });
  }, [containerRef, setTransform]);

  // 将某世界坐标点居中到视口（小地图导航用）
  const centerOn = useCallback((worldX: number, worldY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const k = transformRef.current.k;
    setTransform({ x: rect.width / 2 - worldX * k, y: rect.height / 2 - worldY * k, k });
  }, [containerRef, setTransform]);

  return {
    transform, isPanning,
    screenToWorld,
    handleMouseDown,
    zoomIn, zoomOut, zoomReset, fitView, centerOn,
  };
}
