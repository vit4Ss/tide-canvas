"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useCanvasStore } from "@/stores/use-canvas-store";

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
  const transformRef = useRef(useCanvasStore.getState().transform);
  transformRef.current = useCanvasStore.getState().transform;

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

    const onUp = () => {
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
        const inside = nodes.filter((n) =>
          n.x + n.width >= minX && n.x <= maxX &&
          n.y + n.height >= minY && n.y <= maxY
        );
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
