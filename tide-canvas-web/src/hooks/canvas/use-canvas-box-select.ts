"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { nodeRenderRect } from "@/lib/canvas-helpers";

interface BoxSelectState {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
}

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useCanvasBoxSelect({ containerRef }: Options) {
  const [box, setBox] = useState<BoxSelectState | null>(null);
  const boxRef = useRef<BoxSelectState | null>(null);
  boxRef.current = box;

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = useCanvasStore.getState().transform;
    return {
      x: (sx - rect.left - t.x) / t.k,
      y: (sy - rect.top - t.y) / t.k,
    };
  }, [containerRef]);

  /** 在画布空白处按下时启动框选 */
  const startBoxSelect = useCallback((clientX: number, clientY: number) => {
    const world = screenToWorld(clientX, clientY);
    setBox({
      startWorldX: world.x, startWorldY: world.y,
      currentWorldX: world.x, currentWorldY: world.y,
    });
  }, [screenToWorld]);

  useEffect(() => {
    if (!box) return;

    const onMove = (e: MouseEvent) => {
      const b = boxRef.current;
      if (!b) return;
      const world = screenToWorld(e.clientX, e.clientY);
      setBox({ ...b, currentWorldX: world.x, currentWorldY: world.y });
    };

    const onUp = (e: MouseEvent) => {
      // 右键/中键释放不定格框选(否则拖框途中点右键会提前提交,还与右键菜单叠开)
      if (e.button !== 0) {
        setBox(null);
        return;
      }
      const b = boxRef.current;
      if (!b) {
        setBox(null);
        return;
      }
      // 计算框选区域内的节点
      const minX = Math.min(b.startWorldX, b.currentWorldX);
      const maxX = Math.max(b.startWorldX, b.currentWorldX);
      const minY = Math.min(b.startWorldY, b.currentWorldY);
      const maxY = Math.max(b.startWorldY, b.currentWorldY);

      // 只有当框有实际大小时才选择
      if (Math.abs(maxX - minX) > 5 || Math.abs(maxY - minY) > 5) {
        const nodes = useCanvasStore.getState().nodes;
        // 命中测试用实际渲染矩形:名义 x/width/height 与可见卡片错位,
        // 框住宽图伸出左侧的可见部分选不中、框住竖图右侧的空白反而选中
        const inside = nodes.filter((n) => {
          const r = nodeRenderRect(n);
          return r.x + r.w >= minX && r.x <= maxX && r.y + r.h >= minY && r.y <= maxY;
        });
        useCanvasStore.getState().selectMany(inside.map((n) => n.id));
      }

      setBox(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [box, screenToWorld]);

  return { box, startBoxSelect, isBoxSelecting: !!box };
}
