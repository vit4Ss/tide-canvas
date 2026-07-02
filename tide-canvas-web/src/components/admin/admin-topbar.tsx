"use client";

/* ============================================================================
   AdminTopbar — liuguang `.adm-top` header (title / breadcrumb / search / 通知).

   Faithful to 后台管理.html <header class="adm-top">:
     <div><h1 id="admTitle">…</h1><div class="crumb" id="admCrumb">控制台 / …</div></div>
     <label class="adm-search"><span class="muted">⌕</span><input …></label>
     <button class="tbtn">通知 ⌃</button>

   The title + breadcrumb derive from the active route (findActive) instead of
   the prototype's manual updates. Search routes to 用户管理 filtered by the typed
   keyword (backend GET /api/admin/users?keyword= matches username/email/
   nickname/phone); the users page reads the keyword from the URL on load.
   ============================================================================ */

import { usePathname, useRouter } from "next/navigation";
import NotificationCenter from "@/components/shared/notification-center";
import { findActive } from "./admin-sidebar";

export function AdminTopbar() {
  const pathname = usePathname() || "/admin";
  const router = useRouter();
  const active = findActive(pathname);

  return (
    <header className="adm-top">
      <div>
        <h1>{active.label}</h1>
        <div className="crumb">控制台 / {active.label}</div>
      </div>

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

      <NotificationCenter
        align="right"
        renderTrigger={({ unread, toggle }) => (
          <button
            type="button"
            className="tbtn"
            onClick={toggle}
            style={{ position: "relative" }}
          >
            通知 ⌃
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
