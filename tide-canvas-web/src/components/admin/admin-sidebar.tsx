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
import { ExternalLink, LogOut } from "lucide-react";
import type { Ref } from "react";

export interface AdminNavItem {
  label: string;
  href: string;
  icon: string;
  description: string;
  badge?: string;
}

export type AdminNavEntry = { group: string } | AdminNavItem;

function isGroup(e: AdminNavEntry): e is { group: string } {
  return (e as { group: string }).group !== undefined;
}

export const ADMIN_NAV: AdminNavEntry[] = [
  { group: "总览" },
  { label: "数据概览", href: "/admin", icon: "dash", description: "核心指标、增长趋势与今日运营状态" },
  { group: "运营" },
  { label: "用户管理", href: "/admin/users", icon: "users", description: "账号、角色、套餐与积分余额" },
  { label: "作品管理", href: "/admin/works", icon: "works", description: "作品审核、精选与内容处置" },
  { label: "灵感管理", href: "/admin/inspiration", icon: "insp", description: "灵感集合、提示词与推荐内容" },
  { label: "日志管理", href: "/admin/logs", icon: "log", description: "访问、登录、业务与模型调用记录" },
  { group: "内容" },
  { label: "首页楼层", href: "/admin/home-floors", icon: "floor", description: "首页内容编排、排序与展示策略" },
  { label: "博客管理", href: "/admin/blog", icon: "blog", description: "文章、Telegram 频道源与发布管理" },
  { label: "模型管理", href: "/admin/models", icon: "model", description: "模型目录、供应商、能力与上下架" },
  { label: "模型状态", href: "/admin/model-status", icon: "pulse", description: "已上架模型的可用性与时延探测" },
  { label: "工具管理", href: "/admin/tools", icon: "toolkit", description: "智能工具能力、提示词与入口配置" },
  { group: "商业" },
  { label: "积分管理", href: "/admin/points", icon: "credit", description: "积分规则、流水与人工调整" },
  { label: "价格管理", href: "/admin/pricing", icon: "price", description: "套餐、权益、价格对比与常见问题" },
  { label: "支付管理", href: "/admin/payments", icon: "pay", description: "订单流水、支付渠道与结算状态" },
  { group: "系统" },
  { label: "消息管理", href: "/admin/notifications", icon: "bell", description: "站内通知、受众与触达记录" },
  { label: "配置管理", href: "/admin/config", icon: "cog", description: "站点、存储、注册与系统参数" },
  { label: "邮件配置", href: "/admin/email", icon: "mail", description: "邮件模板、发送配置与 API 密钥" },
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
  sidebarRef?: Ref<HTMLElement>;
}

export function AdminSidebar({ onNavigate, sidebarRef }: AdminSidebarProps) {
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
    <aside ref={sidebarRef} className="adm-side" aria-label="后台导航">
      <Link href="/" className="adm-brand" onClick={onNavigate} aria-label="返回 FlowingLight 首页">
        <Logo size={20} tone="solid" />
        <div className="adm-brand-copy">
          <b>FLOWINGLIGHT</b>
          <small>运营控制台</small>
        </div>
      </Link>

      <nav className="adm-nav" id="admin-primary-navigation" aria-label="后台主导航">
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
              title={entry.label}
              aria-current={entry.href === active.href ? "page" : undefined}
            >
              <svg viewBox="0 0 24 24">
                <path d={ADMIN_ICONS[entry.icon]} />
              </svg>
              <span className="adm-link-label">{entry.label}</span>
              {entry.badge ? <span className="badge">{entry.badge}</span> : null}
            </Link>
          ),
        )}
      </nav>

      <div className="adm-side-foot">
        <span className="av" aria-hidden>
          {(name.trim().slice(0, 1) || "管").toUpperCase()}
        </span>
        <div className="adm-user-copy" title={email ? `${name} · ${email}` : name}>
          <div className="nm">{name}</div>
          <div className="rl">管理员</div>
        </div>
        <span className="acts">
          <Link href="/" title="返回前台" aria-label="返回前台" onClick={onNavigate}>
            <ExternalLink aria-hidden size={14} strokeWidth={1.8} />
          </Link>
          <button type="button" title="退出登录" aria-label="退出登录" onClick={onLogout}>
            <LogOut aria-hidden size={14} strokeWidth={1.8} />
          </button>
        </span>
      </div>
    </aside>
  );
}

export default AdminSidebar;
