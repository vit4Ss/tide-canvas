"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Breadcrumb, Dropdown, Avatar, Tooltip, Button, Result, Spin, theme, type MenuProps } from "antd";
import {
  MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined, ExpandOutlined,
  CompressOutlined, CloseOutlined, LogoutOutlined,
} from "@ant-design/icons";
import { Moon, Sun } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { useThemeMode } from "@/components/shared/theme-mode";
import { useAdminTabs } from "@/stores/use-admin-tabs";
import { useAuthStore } from "@/stores/use-auth-store";
import { ADMIN_GROUPS, ALL_PAGES, PAGE_META, resolveSelectedKey } from "./admin-menu";
import { AdminCommandPalette } from "./admin-command-palette";
import { usePermissionStore, useHasPerm } from "@/stores/use-permission-store";

const { Sider, Header, Content } = Layout;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token } = theme.useToken();
  const { mode, toggle } = useThemeMode();
  const isDark = mode === "dark";

  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);

  const { tabs, addTab, removeTab } = useAdminTabs();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const selectedKey = resolveSelectedKey(pathname);
  const meta = PAGE_META[selectedKey];

  // 拉取当前管理员权限，按视图权限过滤菜单
  const can = useHasPerm();
  const loaded = usePermissionStore((s) => s.loaded);
  const fetchPerms = usePermissionStore((s) => s.fetchPerms);
  useEffect(() => { fetchPerms(); }, [fetchPerms]);

  const visibleGroups = ADMIN_GROUPS
    // perm 省略表示所有管理员可见（如客服消息：后端仅 AdminOnly、无细粒度权限码）
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.perm || can(it.perm)) }))
    .filter((g) => g.items.length > 0);
  const menuItems: MenuProps["items"] = visibleGroups.map((g) => ({
    key: g.key, icon: g.icon, label: g.label,
    children: g.items.map((it) => ({ key: it.key, label: <Link href={it.key}>{it.label}</Link> })),
  }));
  const openGroupKeys = visibleGroups.map((g) => g.key);

  // 直链路由守卫：无权访问当前页则跳转首个可访问页，全无可访问页时显示 403
  const currentPerm = ALL_PAGES.find((p) => p.key === selectedKey)?.perm;
  const pageAllowed = !currentPerm || can(currentPerm);
  const firstAccessibleKey = visibleGroups[0]?.items[0]?.key;
  useEffect(() => {
    if (loaded && !pageAllowed && firstAccessibleKey && firstAccessibleKey !== selectedKey) {
      router.replace(firstAccessibleKey);
    }
  }, [loaded, pageAllowed, firstAccessibleKey, selectedKey, router]);

  // 当前页加入标签
  useEffect(() => {
    if (PAGE_META[selectedKey]) addTab({ key: selectedKey, label: PAGE_META[selectedKey].label });
  }, [selectedKey, addTab]);

  // Ctrl/Cmd + K 打开搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 全屏状态同步
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  const closeTab = useCallback((key: string) => {
    const wasActive = key === selectedKey;
    const next = removeTab(key);
    if (wasActive) router.push(next ?? "/admin");
  }, [selectedKey, removeTab, router]);

  const onAvatarClick: MenuProps["onClick"] = async ({ key }) => {
    if (key === "logout") {
      await logout();
      router.push("/login");
    }
  };

  const sidebarTheme = isDark ? "dark" : "light";

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider
        theme={sidebarTheme}
        collapsed={collapsed}
        collapsedWidth={72}
        width={232}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: "auto" }}
      >
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 56, flexShrink: 0 }}>
          <BrandMark className="h-8 w-8 shrink-0" />
          {!collapsed && <span style={{ fontSize: 15, fontWeight: 700, color: token.colorText, whiteSpace: "nowrap" }}>TideCanvas</span>}
        </Link>
        <Menu
          key={loaded ? "perm-loaded" : "perm-loading"}
          theme={sidebarTheme}
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openGroupKeys}
          items={menuItems}
          style={{ borderInlineEnd: "none" }}
        />
      </Sider>

      <Layout>
        <Header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", height: 56, lineHeight: "56px", background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((c) => !c)} />
            <Breadcrumb items={[{ title: meta?.group ?? "后台" }, { title: meta?.label ?? "" }]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Tooltip title="搜索 (Ctrl+K)"><Button type="text" icon={<SearchOutlined />} onClick={() => setSearchOpen(true)} /></Tooltip>
            <Tooltip title={isFs ? "退出全屏" : "全屏"}><Button type="text" icon={isFs ? <CompressOutlined /> : <ExpandOutlined />} onClick={toggleFullscreen} /></Tooltip>
            <Tooltip title={isDark ? "浅色模式" : "深色模式"}><Button type="text" icon={isDark ? <Sun size={16} /> : <Moon size={16} />} onClick={toggle} /></Tooltip>
            <Dropdown
              menu={{ items: [{ key: "logout", icon: <LogoutOutlined />, label: "退出登录" }], onClick: onAvatarClick }}
              placement="bottomRight"
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "0 8px" }}>
                <Avatar size={28} style={{ background: token.colorPrimary }}>
                  {(user?.nickname || user?.username || "A").charAt(0).toUpperCase()}
                </Avatar>
                <span style={{ fontSize: 13, color: token.colorText }}>{user?.nickname || user?.username || "管理员"}</span>
              </span>
            </Dropdown>
          </div>
        </Header>

        {/* 多标签页签 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`, overflowX: "auto" }}>
          {tabs.map((t) => {
            const activeTab = t.key === selectedKey;
            return (
              <div key={t.key} onClick={() => router.push(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 6,
                  cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", lineHeight: 1.6,
                  border: `1px solid ${activeTab ? token.colorPrimary : token.colorBorderSecondary}`,
                  background: activeTab ? token.colorPrimaryBg : "transparent",
                  color: activeTab ? token.colorPrimary : token.colorText,
                }}>
                {t.label}
                {t.key !== "/admin" && (
                  <CloseOutlined style={{ fontSize: 10, opacity: 0.7 }} onClick={(e) => { e.stopPropagation(); closeTab(t.key); }} />
                )}
              </div>
            );
          })}
        </div>

        <Content style={{ padding: 20, overflow: "auto", background: token.colorBgLayout }}>
          {!loaded ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}><Spin /></div>
          ) : pageAllowed ? (
            children
          ) : (
            <Result status="403" title="403" subTitle="您没有访问该页面的权限" />
          )}
        </Content>
      </Layout>

      <AdminCommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
