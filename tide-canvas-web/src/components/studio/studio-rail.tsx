"use client";

/* ============================================================================
   StudioRail — far-left app sidebar for the (studio) route group.
   Ported 1:1 from design-ref/创作台.html <aside class="ws-rail"> + studio.css.

   Routing (design's dead links wired to real app routes):
     发现     → /            创作     → /studio       生成     → /chat
     画布     → /projects (EXISTING canvas hub)        作品广场 → /explore
     灵感     → /inspire      资产     → /assets        升级 Pro → /pricing
     brand    → /             登录     → /login
   通知 is a placeholder (toast).

   Active state: an item is "on" when usePathname() matches (exact for "/",
   prefix for the rest so /studio/* etc. stay highlighted).
   Uses exact liuguang class names so studio.css applies unchanged.
   ========================================================================== */

import Link from "next/link";
import { Logo } from "@/components/flux/atoms";
import { usePathname } from "next/navigation";
import { toast } from "@/components/shared/toast";
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/* rail icons are bespoke multi-element SVGs from the design — kept verbatim
   (the shared Icon/PATHS set doesn't cover these exact glyphs). */
const NAV_TOP: NavItem[] = [
  {
    href: "/",
    label: "发现",
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
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9 18h6" />
        <path d="M10 21h4" />
        <path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1-1 2H9c0-1-.3-1.4-1-2A6 6 0 0 1 12 3z" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "生成",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "画布",
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

export default function StudioRail() {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();

  const toolClass = (href: string) =>
    `ws-tool${isActive(pathname, href) ? " on" : ""}`;

  const accountName = user?.nickname || user?.username || user?.email || "";
  const initials = accountName.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <aside className="ws-rail">
      <Link className="ws-brand" href="/" title="FlowingLight 流光">
        <Logo size={30} />
        <b>FLOWING</b>
      </Link>

      <div className="ws-rail-sp" />

      <nav className="ws-nav">
        {NAV_TOP.map((item) => (
          <Link
            key={item.href}
            className={toolClass(item.href)}
            href={item.href}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="ws-nav-div" />
      <Link
        className={toolClass(ASSETS_ITEM.href)}
        href={ASSETS_ITEM.href}
        title={ASSETS_ITEM.label}
      >
        {ASSETS_ITEM.icon}
        <span>{ASSETS_ITEM.label}</span>
      </Link>

      <div className="ws-rail-sp" />

      <Link className="ws-upgrade" href="/pricing">
        <div className="ws-upgrade-top">
          <span className="star">★</span> 低至 ¥39/月
        </div>
        <div className="ws-upgrade-btn">升级 Pro</div>
      </Link>

      <button
        className="ws-tool"
        type="button"
        title="通知"
        onClick={() => toast.info("暂无新通知")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <span>通知</span>
      </button>

      {user ? (
        <Link className="ws-tool" href="/account" title={accountName || "个人中心"}>
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
              color: "#0c0e16",
              background: "linear-gradient(135deg,#6d8bf5,#9b7bf0)",
            }}
          >
            {initials}
          </span>
          <span>我的</span>
        </Link>
      ) : (
        <Link className="ws-tool" href="/login" title="登录">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
          <span>登录</span>
        </Link>
      )}
    </aside>
  );
}
