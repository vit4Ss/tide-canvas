"use client";

/* ============================================================================
   StudioRail — far-left app sidebar for the (studio) route group.
   Ported 1:1 from design-ref/创作台.html <aside class="ws-rail"> + studio.css.

   Routing (design's dead links wired to real app routes):
     发现     → /            创作     → /studio       生成     → /chat
     画布     → /projects (EXISTING canvas hub)        作品广场 → /explore
     灵感     → /inspire      资产     → /assets
     brand    → /             登录     → /login
   通知 → 真实通知中心(NotificationCenter,登录后显示,含未读红点/下拉列表)。

   Active state: an item is "on" when usePathname() matches (exact for "/",
   prefix for the rest so /studio/* etc. stay highlighted).
   Uses exact liuguang class names so studio.css applies unchanged.
   ========================================================================== */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/flux/atoms";
import { usePathname } from "next/navigation";
import NotificationCenter from "@/components/shared/notification-center";
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  href: string;
  label: string;
  /** 菜单权限键，与后端 model.FrontMenuKeys / sys_role.permissions 一一对应 */
  key: string;
  icon: React.ReactNode;
}

/* rail icons are bespoke multi-element SVGs from the design — kept verbatim
   (the shared Icon/PATHS set doesn't cover these exact glyphs). */
const NAV_TOP: NavItem[] = [
  {
    href: "/",
    label: "发现",
    key: "discover",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" />
      </svg>
    ),
  },
  {
    href: "/studio",
    label: "创作",
    key: "studio",
    // 魔杖 + 星芒（灯泡留给「灵感」，避免同一隐喻用两次）
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 21L13.5 10.5" />
        <path d="M13 5.5l5.5 5.5" />
        <path d="M17.5 2v3M17.5 9v3M14 5.5h3M21 5.5h-3" />
      </svg>
    ),
  },
  {
    href: "/three-d",
    label: "3D模型",
    key: "three_d",
    // 立方体（与创作台原 3D 页签同形，语义延续）
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3 20 7.5 12 12 4 7.5 12 3Z" />
        <path d="M4 7.5V16.5L12 21V12" />
        <path d="M20 7.5V16.5L12 21" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "生成",
    key: "chat",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "画布",
    key: "canvas",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 8V5a2 2 0 0 1 2-2h3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: "/explore",
    label: "作品广场",
    key: "explore",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/inspire",
    label: "灵感",
    key: "inspire",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9 18h6" />
        <path d="M10 21h4" />
        <path d="M12 2v2M4.9 5l1.4 1.4M2 12h2M19.1 5l-1.4 1.4M20 12h2" />
        <path d="M9 14a4 4 0 1 1 6 0c-.5.5-1 1-1 2h-4c0-1-.5-1.5-1-2z" />
      </svg>
    ),
  },
];

const ASSETS_ITEM: NavItem = {
  href: "/assets",
  label: "资产",
  key: "assets",
  icon: (
    <svg viewBox="0 0 24 24">
      <path d="M3 7l2-3h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z" />
    </svg>
  ),
};

/** true when `pathname` should mark `href` active (exact for "/", prefix otherwise). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** localStorage key for the rail's collapsed state (persists across pages). */
const RAIL_COLLAPSED_KEY = "ws_rail_collapsed";

export default function StudioRail() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();

  // 折叠态：SSR 恒为展开，挂载后从 localStorage 同步（避免 hydration 不一致）。
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后一次性同步外部存储
      setCollapsed(localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const toolClass = (href: string) =>
    `ws-tool${isActive(pathname, href) ? " on" : ""}`;

  // 角色菜单过滤：登录用户按 /api/auth/me 的 menus(后台角色配置)展示,配置了才显示;
  // 未登录或旧会话缓存无 menus 字段时回退全量(侧栏永不空白)。
  const menuAllowed = (key: string) =>
    !user || !Array.isArray(user.menus) || user.menus.includes(key);
  const navTop = NAV_TOP.filter((item) => menuAllowed(item.key));
  const showAssets = menuAllowed(ASSETS_ITEM.key);

  const accountName = user?.nickname || user?.username || user?.email || "";
  const initials = accountName.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <>
    <aside className={`ws-rail${collapsed ? " collapsed" : ""}`}>
      <Link className="ws-brand" href="/" title="FlowingLight 流光">
        <Logo size={30} />
        <b>FLOWING</b>
      </Link>

      <div className="ws-rail-sp" />

      <nav className="ws-nav">
        {navTop.map((item) => (
          <Link
            key={item.href}
            className={toolClass(item.href)}
            href={item.href}
            title={item.label}
          >
            <span className="ic">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {showAssets && (
        <>
          <div className="ws-nav-div" />
          <Link
            className={toolClass(ASSETS_ITEM.href)}
            href={ASSETS_ITEM.href}
            title={ASSETS_ITEM.label}
          >
            <span className="ic">{ASSETS_ITEM.icon}</span>
            <span>{ASSETS_ITEM.label}</span>
          </Link>
        </>
      )}

      <div className="ws-rail-sp" />

      {user && (
        <NotificationCenter
          renderTrigger={({ unread, toggle, open }) => (
            <button
              className={`ws-tool${open ? " on" : ""}`}
              type="button"
              title="通知"
              onClick={toggle}
            >
              <span className="ic" style={{ position: "relative" }}>
                <svg viewBox="0 0 24 24">
                  <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                {unread > 0 && (
                  <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
                )}
              </span>
              <span>通知</span>
            </button>
          )}
        />
      )}

      {user ? (
        <Link className="ws-tool" href="/account" title={accountName || "个人中心"}>
          <span className="ic">
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                display: "grid",
                placeItems: "center",
                fontSize: 10,
                fontWeight: 800,
                color: "#fff",
                background: "linear-gradient(135deg,#4f46e5,#a855f7)",
              }}
            >
              {initials}
            </span>
          </span>
          <span>我的</span>
        </Link>
      ) : (
        <Link className="ws-tool" href="/login" title="登录">
          <span className="ic">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          </span>
          <span>登录</span>
        </Link>
      )}

    </aside>

    {/* 折叠开关：骑在侧栏右缘的圆形把手（须为 .ws-rail 的紧邻兄弟节点，
        studio.css 用 left 与栏宽做同参数过渡让它跟着栏边滑动） */}
    <button
      className={`ws-rail-handle${collapsed ? " is-collapsed" : ""}`}
      type="button"
      aria-label={collapsed ? "展开导航" : "收起导航"}
      aria-expanded={!collapsed}
      title={collapsed ? "展开导航" : "收起导航"}
      onClick={toggleCollapsed}
    >
      <svg viewBox="0 0 24 24">
        <path d="M14.5 6.5L9 12l5.5 5.5" />
      </svg>
    </button>
    </>
  );
}
