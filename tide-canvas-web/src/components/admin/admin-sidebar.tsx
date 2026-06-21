"use client";

/* ============================================================================
   AdminSidebar — liuguang `.adm-side` navigation rail.

   Faithful port of admin.js NAV + buildNav() markup:
     <aside class="adm-side">
       <div class="adm-brand">…SCARECROW / ADMIN CONSOLE</div>
       <nav class="adm-nav">  (grouped: .adm-grp + .adm-link[.on] + .badge)
       <div class="adm-side-foot">…运营管理员 / 超级管理员 / 返回前台</div>
     </aside>

   Differences from the prototype (intentional, for the real router):
     - each nav item maps to a real /admin/* route (per the task spec).
     - active state derives from usePathname() instead of hash routing.
     - 返回前台 (↩) links to "/" via next/link.

   Section → route map (single source of truth, also used by the topbar):
     ADMIN_NAV / findActive() are exported for AdminTopbar.
   ============================================================================ */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_ICONS } from "@/mock/admin";

export interface AdminNavItem {
  /** Display label. */
  label: string;
  /** Route, e.g. "/admin/users". */
  href: string;
  /** Icon key into ADMIN_ICONS. */
  icon: string;
  /** Optional right-aligned badge (e.g. "5.2M"). */
  badge?: string;
}

export type AdminNavEntry = { group: string } | AdminNavItem;

function isGroup(e: AdminNavEntry): e is { group: string } {
  return (e as { group: string }).group !== undefined;
}

/**
 * The full 15-section nav, grouped exactly as in admin.js NAV.
 * Route mapping per the task spec.
 */
export const ADMIN_NAV: AdminNavEntry[] = [
  { group: "总览" },
  { label: "数据概览", href: "/admin", icon: "dash" },
  { group: "运营" },
  { label: "用户管理", href: "/admin/users", icon: "users", badge: "5.2M" },
  { label: "作品管理", href: "/admin/works", icon: "works" },
  { label: "灵感管理", href: "/admin/inspiration", icon: "insp" },
  { label: "日志管理", href: "/admin/logs", icon: "log" },
  { group: "内容" },
  { label: "首页楼层", href: "/admin/home-floors", icon: "floor" },
  { label: "发现管理", href: "/admin/discover", icon: "discover" },
  { label: "模型管理", href: "/admin/models", icon: "model" },
  { label: "资源管理", href: "/admin/resources", icon: "res" },
  { group: "商业" },
  { label: "积分管理", href: "/admin/points", icon: "credit" },
  { label: "营销管理", href: "/admin/marketing", icon: "promo" },
  { label: "价格管理", href: "/admin/pricing", icon: "price" },
  { label: "支付管理", href: "/admin/payments", icon: "pay" },
  { group: "系统" },
  { label: "配置管理", href: "/admin/config", icon: "cog" },
  { label: "邮件配置", href: "/admin/email", icon: "mail" },
];

/** Flat list of just the link items (no groups). */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.filter(
  (e): e is AdminNavItem => !isGroup(e),
);

/**
 * Resolve the active nav item for a pathname. Longest-prefix match so e.g.
 * /admin/users/123 still highlights 用户管理, while /admin stays exact.
 */
export function findActive(pathname: string): AdminNavItem {
  // exact dashboard
  if (pathname === "/admin") return ADMIN_NAV_ITEMS[0];
  // longest non-root match
  const matches = ADMIN_NAV_ITEMS.filter(
    (it) => it.href !== "/admin" && (pathname === it.href || pathname.startsWith(it.href + "/")),
  );
  if (matches.length) {
    return matches.reduce((a, b) => (b.href.length > a.href.length ? b : a));
  }
  return ADMIN_NAV_ITEMS[0];
}

export function AdminSidebar() {
  const pathname = usePathname() || "/admin";
  const active = findActive(pathname);

  return (
    <aside className="adm-side">
      <div className="adm-brand">
        <span className="glyph" />
        <div>
          <b>SCARECROW</b>
          <small>ADMIN CONSOLE</small>
        </div>
      </div>

      <nav className="adm-nav">
        {ADMIN_NAV.map((entry, i) =>
          isGroup(entry) ? (
            <div className="adm-grp" key={`g-${entry.group}-${i}`}>
              {entry.group}
            </div>
          ) : (
            <Link
              key={entry.href}
              href={entry.href}
              className={`adm-link${entry.href === active.href ? " on" : ""}`}
            >
              <svg viewBox="0 0 24 24">
                <path d={ADMIN_ICONS[entry.icon]} />
              </svg>
              <span>{entry.label}</span>
              {entry.badge ? <span className="badge">{entry.badge}</span> : null}
            </Link>
          ),
        )}
      </nav>

      <div className="adm-side-foot">
        <span className="av" />
        <div>
          <div className="nm">运营管理员</div>
          <div className="rl">超级管理员</div>
        </div>
        <Link href="/" title="返回前台">
          ↩
        </Link>
      </div>
    </aside>
  );
}

export default AdminSidebar;
