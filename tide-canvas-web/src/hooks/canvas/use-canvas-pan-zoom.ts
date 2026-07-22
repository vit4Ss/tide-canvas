"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasViewStore, type CanvasTransform } from "@/stores/use-canvas-view-store";
import { nodeRenderRect } from "@/lib/canvas-helpers";

interface UsePanZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useCanvasPanZoom({ containerRef }: UsePanZoomOptions) {
  // transform 在独立 view store（高频 set 不触发节点数据 store 的订阅者）。
  // 本 hook 不做渲染订阅——否则宿主 CanvasView 每帧重渲染整棵画布树；
  // 需要 transform 的渲染方（世界层/网格/工具坞/小地图）各自细粒度订阅。
  const setTransform = useCanvasViewStore((s) => s.setTransform);
  const [isPanning, setIsPanning] = useState(false);

  // 最新 transform 经 store.subscribe 镜像进 ref，供事件回调同步读取
  const transformRef = useRef(useCanvasViewStore.getState().transform);
  useEffect(
    () => useCanvasViewStore.subscribe((s) => { transformRef.current = s.transform; }),
    [],
  );

  // 高频输入(wheel/mousemove)合帧提交:事件里只算目标值,每帧最多落一次 store,
  // 避免高刷设备上 wheel/move 以 >120Hz 触发同样次数的 React 提交。
  // pendingRef 同时作为帧内的"最新值"参与连续计算,不丢增量。
  const pendingRef = useRef<CanvasTransform | null>(null);
  const rafRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  const scheduleTransform = useCallback((next: CanvasTransform) => {
    pendingRef.current = next;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (pendingRef.current) {
        setTransform(pendingRef.current);
        pendingRef.current = null;
      }
    });
  }, [setTransform]);
  // 帧内连续计算的基准:未提交的 pending 优先于 store 值
  const currentTransform = useCallback(
    () => pendingRef.current ?? transformRef.current,
    [],
  );
  // 程序化定位（重置/适应视图/居中/按钮缩放）前必须作废待提交帧:
  // 否则触控板惯性滚动残留的 pending 会在下一帧 flush,覆盖掉刚设置的视口
  const cancelPendingTransform = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingRef.current = null;
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // pending 优先:平移/缩放进行中屏幕上显示的还是待提交值前的画面,
    // 但落点换算要对齐下一帧真正生效的视口
    const t = pendingRef.current ?? transformRef.current;
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
      const t = currentTransform();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newK = Math.min(Math.max(t.k * delta, 0.1), 5);
        scheduleTransform({
          x: mx - (mx - t.x) * (newK / t.k),
          y: my - (my - t.y) * (newK / t.k),
          k: newK,
        });
      } else {
        scheduleTransform({
          ...t,
          x: t.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: t.y - (e.shiftKey ? 0 : e.deltaY),
        });
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, scheduleTransform, currentTransform]);

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
    // 起点基于 pending 优先的当前值:紧跟惯性滚动开始平移时不跳一帧
    const t0 = currentTransform();
    const start = { x: e.clientX - t0.x, y: e.clientY - t0.y };
    setIsPanning(true);

    const onMove = (ev: MouseEvent) => {
      scheduleTransform({ ...currentTransform(), x: ev.clientX - start.x, y: ev.clientY - start.y });
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
  }, [containerRef, scheduleTransform, currentTransform]);

  const zoomAtCenter = useCallback((factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const t = currentTransform();
    cancelPendingTransform();
    const newK = Math.min(Math.max(t.k * factor, 0.1), 5);
    setTransform({
      x: mx - (mx - t.x) * (newK / t.k),
      y: my - (my - t.y) * (newK / t.k),
      k: newK,
    });
  }, [containerRef, setTransform, currentTransform, cancelPendingTransform]);

  const zoomIn = useCallback(() => zoomAtCenter(1.2), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter(1 / 1.2), [zoomAtCenter]);
  const zoomReset = useCallback(() => {
    cancelPendingTransform();
    setTransform({ x: 0, y: 0, k: 1 });
  }, [setTransform, cancelPendingTransform]);

  // 缩放到适应全部节点（无节点时回到原点）
  const fitView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    cancelPendingTransform();
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
  }, [containerRef, setTransform, cancelPendingTransform]);

  // 将某世界坐标点居中到视口（小地图导航用）
  const centerOn = useCallback((worldX: number, worldY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const k = currentTransform().k;
    cancelPendingTransform();
    setTransform({ x: rect.width / 2 - worldX * k, y: rect.height / 2 - worldY * k, k });
  }, [containerRef, setTransform, currentTransform, cancelPendingTransform]);

  return {
    isPanning,
    screenToWorld,
    handleMouseDown,
    zoomIn, zoomOut, zoomReset, fitView, centerOn,
  };
}
