import type { ReactNode } from "react";
import {
  LayoutDashboard, Users, Wallet, Bot, Settings, ScrollText,
} from "lucide-react";

export interface AdminPage {
  key: string;
  label: string;
}

export interface AdminGroup {
  key: string;
  label: string;
  icon: ReactNode;
  items: AdminPage[];
}

/** 后台菜单分组（概览 / 用户与内容 / 营收 / AI / 系统 / 日志） */
export const ADMIN_GROUPS: AdminGroup[] = [
  {
    key: "overview", label: "概览", icon: <LayoutDashboard size={16} />,
    items: [
      { key: "/admin", label: "数据面板" },
      { key: "/admin/monitor", label: "监控总览" },
    ],
  },
  {
    key: "user", label: "用户与内容", icon: <Users size={16} />,
    items: [
      { key: "/admin/users", label: "用户管理" },
      { key: "/admin/contents", label: "内容管理" },
      { key: "/admin/authors", label: "作者管理" },
      { key: "/admin/banners", label: "Banner 管理" },
      { key: "/admin/files", label: "文件管理" },
    ],
  },
  {
    key: "revenue", label: "营收", icon: <Wallet size={16} />,
    items: [
      { key: "/admin/points", label: "积分管理" },
      { key: "/admin/orders", label: "订单管理" },
      { key: "/admin/redeem", label: "兑换码" },
    ],
  },
  {
    key: "ai", label: "AI", icon: <Bot size={16} />,
    items: [
      { key: "/admin/ai/providers", label: "AI 供应商" },
      { key: "/admin/ai/models", label: "模型管理" },
      { key: "/admin/ai/handlers", label: "Handler 积分" },
      { key: "/admin/ai/logs", label: "AI 日志" },
    ],
  },
  {
    key: "system", label: "系统", icon: <Settings size={16} />,
    items: [
      { key: "/admin/email-templates", label: "邮件模板" },
      { key: "/admin/settings", label: "系统设置" },
    ],
  },
  {
    key: "logs", label: "日志", icon: <ScrollText size={16} />,
    items: [
      { key: "/admin/logs", label: "系统日志" },
      { key: "/admin/access-logs", label: "访问日志" },
      { key: "/admin/login-logs", label: "登录日志" },
    ],
  },
];

/** 扁平页面列表（命令面板 / 标签匹配用） */
export const ALL_PAGES = ADMIN_GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, group: g.label })));

/** 路径 → { label, group }（面包屑 / 页签标题用） */
export const PAGE_META: Record<string, { label: string; group: string }> =
  Object.fromEntries(ALL_PAGES.map((p) => [p.key, { label: p.label, group: p.group }]));

/** 取当前 pathname 对应的菜单 key（最长前缀匹配；/admin 仅精确） */
export function resolveSelectedKey(pathname: string): string {
  return ALL_PAGES
    .map((p) => p.key)
    .filter((k) => (k === "/admin" ? pathname === "/admin" : pathname.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0] || "/admin";
}
