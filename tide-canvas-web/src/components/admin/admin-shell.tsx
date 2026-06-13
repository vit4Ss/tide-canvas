"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layout, Menu } from "antd";
import {
  LayoutDashboard, Users, FileImage, Bot, Image as ImageIcon, FolderOpen,
  ScrollText, Settings, Layers, Coins, PenTool, ShoppingCart, Ticket, Mail,
} from "lucide-react";

const { Sider, Header, Content } = Layout;

/** 菜单项：key 为路由路径，用于按当前 pathname 高亮 */
const MENU = [
  { key: "/admin", icon: <LayoutDashboard size={16} />, label: "数据面板" },
  { key: "/admin/users", icon: <Users size={16} />, label: "用户管理" },
  { key: "/admin/contents", icon: <FileImage size={16} />, label: "内容管理" },
  { key: "/admin/points", icon: <Coins size={16} />, label: "积分管理" },
  { key: "/admin/authors", icon: <PenTool size={16} />, label: "作者管理" },
  { key: "/admin/orders", icon: <ShoppingCart size={16} />, label: "订单管理" },
  { key: "/admin/redeem", icon: <Ticket size={16} />, label: "兑换码" },
  { key: "/admin/ai/providers", icon: <Bot size={16} />, label: "AI 供应商" },
  { key: "/admin/ai/models", icon: <Bot size={16} />, label: "模型管理" },
  { key: "/admin/ai/handlers", icon: <Coins size={16} />, label: "Handler 积分" },
  { key: "/admin/ai/logs", icon: <ScrollText size={16} />, label: "操作日志" },
  { key: "/admin/banners", icon: <ImageIcon size={16} />, label: "Banner 管理" },
  { key: "/admin/files", icon: <FolderOpen size={16} />, label: "文件管理" },
  { key: "/admin/logs", icon: <ScrollText size={16} />, label: "系统日志" },
  { key: "/admin/email-templates", icon: <Mail size={16} />, label: "邮件模板" },
  { key: "/admin/settings", icon: <Settings size={16} />, label: "系统设置" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 当前选中：最长前缀匹配（/admin 仅精确命中，避免被所有子路由抢高亮）
  const selectedKey =
    MENU.map((m) => m.key)
      .filter((k) => (k === "/admin" ? pathname === "/admin" : pathname.startsWith(k)))
      .sort((a, b) => b.length - a.length)[0] || "/admin";

  const items = MENU.map((m) => ({
    key: m.key,
    icon: m.icon,
    label: <Link href={m.key}>{m.label}</Link>,
  }));

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider theme="light" width={220} style={{ borderRight: "1px solid #f0f0f0", overflow: "auto" }}>
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 20px" }}>
          <span style={{ display: "inline-flex", height: 32, width: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, background: "#171717" }}>
            <Layers size={16} color="#fff" />
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#171717" }}>TideCanvas 管理</span>
        </Link>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={items} style={{ borderInlineEnd: "none" }} />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", paddingInline: 24, display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>管理后台</span>
        </Header>
        <Content style={{ padding: 24, overflow: "auto", background: "#f5f5f5" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
