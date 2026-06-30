import { create } from "zustand";

export interface AdminTab {
  key: string;
  label: string;
}

interface AdminTabsState {
  tabs: AdminTab[];
  /** 加入标签（已存在则忽略） */
  addTab: (tab: AdminTab) => void;
  /** 移除标签，返回应跳转到的相邻标签 key（无可跳转则 null） */
  removeTab: (key: string) => string | null;
}

const HOME: AdminTab = { key: "/admin", label: "数据面板" };

export const useAdminTabs = create<AdminTabsState>((set, get) => ({
  tabs: [HOME],
  addTab: (tab) =>
    set((s) => (s.tabs.some((t) => t.key === tab.key) ? s : { tabs: [...s.tabs, tab] })),
  removeTab: (key) => {
    if (key === HOME.key) return null; // 首页标签不可关闭
    const { tabs } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    const next = tabs.filter((t) => t.key !== key);
    set({ tabs: next });
    if (idx < 0 || next.length === 0) return null;
    return next[Math.min(idx, next.length - 1)].key;
  },
}));
