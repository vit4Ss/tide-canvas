import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CanvasTab {
  token: string;
  name: string;
}

interface CanvasTabsState {
  tabs: CanvasTab[];
  /** 打开画布：已存在则更新名称，否则追加 */
  openTab: (tab: CanvasTab) => void;
  renameTab: (token: string, name: string) => void;
  closeTab: (token: string) => void;
}

/**
 * 已打开的画布标签（持久化到 localStorage，刷新/重进保留）。
 * 画布页加载项目时 openTab 注册自己；标签栏在 (canvas)/layout 顶部渲染。
 */
export const useCanvasTabs = create<CanvasTabsState>()(
  persist(
    (set) => ({
      tabs: [],
      openTab: (tab) =>
        set((s) =>
          s.tabs.some((t) => t.token === tab.token)
            ? { tabs: s.tabs.map((t) => (t.token === tab.token ? { ...t, name: tab.name } : t)) }
            : { tabs: [...s.tabs, tab] },
        ),
      renameTab: (token, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.token === token ? { ...t, name } : t)) })),
      closeTab: (token) => set((s) => ({ tabs: s.tabs.filter((t) => t.token !== token) })),
    }),
    { name: "tc:canvas:tabs" },
  ),
);
