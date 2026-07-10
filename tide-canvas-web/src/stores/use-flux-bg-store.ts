// ============================================================================
// 流光背景桥接 store — 首页背景组件（flux-bg）与导航切换器（site-nav 里的
// .bg-nav）之间的最小共享状态。design-ref 里切换器由 home-render.js 直接
// insertBefore 进 .nav-right；React 化后二者分属不同组件树，改由本 store 桥接：
// FluxBg 挂载时 activate（带上后台是否允许用户切换 + 当前预设），卸载时
// deactivate；SiteNav 只在 active && allowSwitch 时渲染切换器。
// ============================================================================

import { create } from "zustand";

interface FluxBgState {
  /** 首页背景已挂载（离开首页即 false，切换器随之消失）。 */
  active: boolean;
  /** 后台「允许用户切换」开关（home.global.fluxUserSwitch）。 */
  allowSwitch: boolean;
  /** 当前生效的预设 key（FLUX_PRESETS）。 */
  preset: string;
  activate: (preset: string, allowSwitch: boolean) => void;
  deactivate: () => void;
  setPreset: (preset: string) => void;
}

export const useFluxBgStore = create<FluxBgState>((set) => ({
  active: false,
  allowSwitch: false,
  preset: "aurora",
  activate: (preset, allowSwitch) => set({ active: true, preset, allowSwitch }),
  deactivate: () => set({ active: false }),
  setPreset: (preset) => set({ preset }),
}));
