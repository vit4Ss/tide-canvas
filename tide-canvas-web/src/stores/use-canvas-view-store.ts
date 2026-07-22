"use client";

import { create } from "zustand";

export interface CanvasTransform {
  x: number;
  y: number;
  k: number;
}

interface CanvasViewState {
  transform: CanvasTransform;
  setTransform: (transform: CanvasTransform) => void;
}

/**
 * 画布视口(平移/缩放)独立 store。
 * <p>
 * 与节点数据分离的原因是性能:平移/缩放每次 mousemove 都 set 一次,若与 nodes
 * 同store,zustand 会在每次 set 时运行所有订阅者的 selector——每个节点组件有
 * 多个扫描 nodes/connections 的派生 selector,N 个节点 × 每秒上百次就是白白的
 * O(N²) 扫描。拆开后视口变化只触达真正订阅视口的少数组件。
 */
export const useCanvasViewStore = create<CanvasViewState>((set) => ({
  transform: { x: 0, y: 0, k: 1 },
  setTransform: (transform) => set({ transform }),
}));
