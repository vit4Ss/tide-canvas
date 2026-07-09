"use client";

/* ============================================================================
   AdminTopbar — title + contextual search + notifications + mobile menu.

   Search only appears on user-related routes (avoids "search users" on every page).
   Breadcrumb is hidden via CSS; kept off to reduce noise.
   ============================================================================ */

import { usePathname, useRouter } from "next/navigation";
import NotificationCenter from "@/components/shared/notification-center";
import { findActive } from "./admin-sidebar";

function showUserSearch(pathname: string): boolean {
  return pathname === "/admin/users" || pathname.startsWith("/admin/users/");
}

export interface AdminTopbarProps {
  onMenuClick?: () => void;
}

export function AdminTopbar({ onMenuClick }: AdminTopbarProps) {
  const pathname = usePathname() || "/admin";
  const router = useRouter();
  const active = findActive(pathname);
  const canSearchUsers = showUserSearch(pathname);

  return (
    <header className="adm-top">
      <button
        type="button"
        className="adm-menu-btn"
        aria-label="打开导航"
        onClick={onMenuClick}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <div>
        <h1>{active.label}</h1>
      </div>

      {canSearchUsers ? (
        <label className="adm-search">
          <span className="muted">⌕</span>
          <input
            type="text"
            placeholder="搜索用户（邮箱 / 昵称 / 手机）…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const q = (e.target as HTMLInputElement).value.trim().slice(0, 100);
                router.push(q ? `/admin/users?keyword=${encodeURIComponent(q)}` : "/admin/users");
              }
            }}
          />
        </label>
      ) : (
        <div style={{ marginLeft: "auto" }} />
      )}

      <NotificationCenter
        align="right"
        tone="light"
        renderTrigger={({ unread, toggle }) => (
          <button
            type="button"
            className="tbtn"
            onClick={toggle}
            style={{ position: "relative" }}
          >
            通知
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
