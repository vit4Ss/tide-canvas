"use client";

/* ============================================================================
   AdminSidebar — dense nav rail for the ops console.
   底部身份区读真实登录用户（原「运营管理员/超级管理员」为硬编码占位，
   2026-07 审计修正），并提供 前台 / 退出登录 两个动作。
   ============================================================================ */

import Link from "next/link";
import { Logo } from "@/components/flux/atoms";
import { usePathname, useRouter } from "next/navigation";
import { ADMIN_ICONS } from "@/mock/admin";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
}

export type AdminNavEntry = { group: string } | AdminNavItem;

function isGroup(e: AdminNavEntry): e is { group: string } {
  return (e as { group: string }).group !== undefined;
}

export const ADMIN_NAV: AdminNavEntry[] = [
  { group: "总览" },
  { label: "数据概览", href: "/admin", icon: "dash" },
  { group: "运营" },
  { label: "用户管理", href: "/admin/users", icon: "users" },
  { label: "作品管理", href: "/admin/works", icon: "works" },
  { label: "灵感管理", href: "/admin/inspiration", icon: "insp" },
  { label: "日志管理", href: "/admin/logs", icon: "log" },
  { group: "内容" },
  { label: "首页楼层", href: "/admin/home-floors", icon: "floor" },
  { label: "模型管理", href: "/admin/models", icon: "model" },
  { label: "工具管理", href: "/admin/tools", icon: "toolkit" },
  { group: "商业" },
  { label: "积分管理", href: "/admin/points", icon: "credit" },
  { label: "价格管理", href: "/admin/pricing", icon: "price" },
  { label: "支付管理", href: "/admin/payments", icon: "pay" },
  { group: "系统" },
  { label: "消息管理", href: "/admin/notifications", icon: "bell" },
  { label: "配置管理", href: "/admin/config", icon: "cog" },
  { label: "邮件配置", href: "/admin/email", icon: "mail" },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.filter(
  (e): e is AdminNavItem => !isGroup(e),
);

export function findActive(pathname: string): AdminNavItem {
  if (pathname === "/admin") return ADMIN_NAV_ITEMS[0];
  const matches = ADMIN_NAV_ITEMS.filter(
    (it) => it.href !== "/admin" && (pathname === it.href || pathname.startsWith(it.href + "/")),
  );
  if (matches.length) {
    return matches.reduce((a, b) => (b.href.length > a.href.length ? b : a));
  }
  return ADMIN_NAV_ITEMS[0];
}

export interface AdminSidebarProps {
  onNavigate?: () => void;
}

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const pathname = usePathname() || "/admin";
  const active = findActive(pathname);
  const router = useRouter();
  const { user } = useAuth();
  const logout = useAuthStore((s) => s.logout);

  // 真实登录身份（admin-guard 保证 role=9 才能到这里）；会话未就绪时的占位。
  const name = user ? user.nickname || user.username : "管理员";
  const email = user?.email ?? "";

  const onLogout = async () => {
    onNavigate?.();
    try {
      await logout();
    } finally {
      toast.success("已退出登录");
      router.push("/");
    }
  };

  return (
    <aside className="adm-side">
      <Link href="/" className="adm-brand" onClick={onNavigate}>
        <Logo size={20} tone="solid" />
        <div>
          <b>FLOWINGLIGHT</b>
          <small>Admin</small>
        </div>
      </Link>

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
              onClick={onNavigate}
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
        <span className="av" aria-hidden>
          {(name.trim().slice(0, 1) || "管").toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="nm">{name}</div>
          <div className="rl" title={email}>
            {email || "管理员"}
          </div>
        </div>
        <span className="acts">
          <Link href="/" title="返回前台" onClick={onNavigate}>
            前台
          </Link>
          <button type="button" title="退出登录" onClick={onLogout}>
            退出
          </button>
        </span>
      </div>
    </aside>
  );
}

export default AdminSidebar;
