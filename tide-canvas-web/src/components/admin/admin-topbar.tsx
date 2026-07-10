"use client";

/* ============================================================================
   AdminTopbar — title + contextual search + notifications + mobile menu.

   Search only appears on user-related routes (avoids "search users" on every page).
   Breadcrumb is hidden via CSS; kept off to reduce noise.
   ============================================================================ */

import { usePathname } from "next/navigation";
import NotificationCenter from "@/components/shared/notification-center";
import { findActive } from "./admin-sidebar";
import { Bell, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

export interface AdminTopbarProps {
  onMenuClick?: () => void;
  onCollapseClick?: () => void;
  navOpen?: boolean;
  collapsed?: boolean;
}

export function AdminTopbar({
  onMenuClick,
  onCollapseClick,
  navOpen = false,
  collapsed = false,
}: AdminTopbarProps) {
  const pathname = usePathname() || "/admin";
  const active = findActive(pathname);

  return (
    <header className="adm-top">
      <button
        type="button"
        className="adm-menu-btn"
        aria-label={navOpen ? "关闭导航" : "打开导航"}
        aria-expanded={navOpen}
        aria-controls="admin-primary-navigation"
        onClick={onMenuClick}
      >
        <Menu aria-hidden size={17} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        className="adm-collapse-btn"
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        aria-pressed={collapsed}
        onClick={onCollapseClick}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden size={17} strokeWidth={1.8} />
        ) : (
          <PanelLeftClose aria-hidden size={17} strokeWidth={1.8} />
        )}
      </button>

      <div className="adm-title-block">
        <h1>{active.label}</h1>
        <p>{active.description}</p>
      </div>

      <div className="adm-top-spacer" />

      <NotificationCenter
        align="right"
        tone="light"
        renderTrigger={({ unread, open, panelId, toggle }) => (
          <button
            type="button"
            className="tbtn"
            onClick={toggle}
            aria-label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={panelId}
          >
            <Bell aria-hidden size={15} strokeWidth={1.8} />
            <span className="tbtn-label">通知</span>
            {unread > 0 && (
              <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
            )}
          </button>
        )}
      />
    </header>
  );
}

export default AdminTopbar;
