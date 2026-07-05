"use client";

/* ============================================================================
   SiteNav — React client port of navHTML(active) from the UPDATED
   design-ref/liuguang/shell.js. Uses the exact liuguang class names from
   flux.css (.nav / .nav-in / .brand / .glyph / .nlink[.on] / .tag / .nav-right
   / .icbtn / .vip / .signin) so the shared styles apply unchanged.

   What changed this sync: navHTML() now renders an account entry after 会员特惠.
   When signed in it's the user AVATAR (the new .acct dropdown — the round
   element between the 会员特惠 button and the edge of the nav, replacing the
   old plain "登录" text). Clicking it opens a small menu with the user's plan +
   积分 and links to 个人中心 / 我的作品 / 创作台 (and 管理后台 for admins) plus
   退出登录. Signed out, it stays a plain 登录 → /login link. The .acct* styles
   are new (not yet in flux.css) and are co-located in ./site-nav.css.

   - next/link for internal navigation.
   - Active link derived from usePathname() (the design's `active` key).
   - Replicates the scroll-past-40px `.solid` toggle from shell.mountChrome().
   - Lang button surfaces the existing app toast.
   - Account dropdown reproduces shell.bindAccount(): toggle on trigger,
     close on outside-click / Escape, logout wired to the real auth store.
   ========================================================================== */

import Link from "next/link";
import { Logo } from "@/components/flux/atoms";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/shared/toast";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { fmt } from "@/mock";
import "./site-nav.css";

interface NavItem {
  /** active key (matched against the resolved route) */
  k: string;
  label: string;
  href: string;
  /** route prefixes that should mark this link active */
  match: string[];
  tag?: string;
}

const NAV: NavItem[] = [
  { k: "home", label: "发现", href: "/", match: ["/"] },
  { k: "explore", label: "作品广场", href: "/explore", match: ["/explore"] },
  { k: "create", label: "创作台", href: "/studio", match: ["/studio"] },
  { k: "pricing", label: "价格方案", href: "/pricing", match: ["/pricing"], tag: "限时" },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return item.match.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/* helpers ported from shell.js (FX.initials / FX.avatarGrad) */
function initials(name: string): string {
  const s = (name || "").trim();
  return (s.slice(0, 2) || "U").toUpperCase();
}
function avatarGrad(seed: string): string {
  let h = 0;
  const s = seed || "u";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  // 灰阶头像（主题零彩色）：哈希只驱动明度差异，白字始终可读
  return `linear-gradient(135deg, hsl(0 0% ${30 + (h % 16)}%), hsl(0 0% ${14 + (h % 10)}%))`;
}
function planLabel(vipLevel?: number): string {
  switch (vipLevel) {
    case 1:
      return "专业版";
    case 2:
      return "团队版";
    case 3:
      return "旗舰版";
    default:
      return "免费版";
  }
}

export default function SiteNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const acctRef = useRef<HTMLDivElement>(null);
  const { user, isAdmin } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);

  // scroll-past-40px .solid toggle (mirrors shell.mountChrome)
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const solid = () => nav.classList.toggle("solid", window.scrollY > 40);
    window.addEventListener("scroll", solid, { passive: true });
    solid();
    return () => window.removeEventListener("scroll", solid);
  }, []);

  // account dropdown: close on outside-click / Escape (mirrors bindAccount)
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (acctRef.current && !acctRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // close menus on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const onLogout = async () => {
    setOpen(false);
    try {
      await logout();
    } finally {
      toast.success("已退出登录");
      router.push("/");
    }
  };

  const name = user ? user.nickname || user.username : "";
  const grad = user ? avatarGrad(user.email || name) : "";

  return (
    <nav className="nav" id="nav" ref={navRef}>
      <div className="wrap nav-in">
        <Link className="brand" href="/">
          <Logo size={26} />
          FLOWING<b>LIGHT</b>
        </Link>

        <div className="nav-links">
          {NAV.map((n) => (
            <Link
              key={n.k}
              className={`nlink${isActive(n, pathname) ? " on" : ""}`}
              href={n.href}
            >
              {n.label}
              {n.tag && <span className="tag">{n.tag}</span>}
            </Link>
          ))}
        </div>

        <div className="nav-right">
          <button
            type="button"
            className="icbtn"
            title="语言"
            onClick={() => toast.info("Language · 中 / EN")}
          >
            文
          </button>

          <Link className="vip" href="/pricing">
            会员特惠
          </Link>

          {user ? (
            <div className={`acct${open ? " open" : ""}`} ref={acctRef}>
              <button
                type="button"
                className="acct-trigger"
                aria-haspopup="true"
                aria-expanded={open}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((v) => !v);
                }}
              >
                <span className="acct-av" style={{ background: grad }}>
                  {initials(name)}
                </span>
              </button>

              <div className="acct-menu" role="menu">
                <div className="acct-head">
                  <span className="acct-av lg" style={{ background: grad }}>
                    {initials(name)}
                  </span>
                  <div className="acct-id">
                    <div className="acct-nm">
                      {name}
                      {isAdmin && <span className="acct-role">管理员</span>}
                    </div>
                    <div className="acct-em">{user.email}</div>
                  </div>
                </div>

                <Link className="acct-credits" href="/pricing">
                  <div>
                    {/* 类名避开 pages.css 的 .plan 定价卡样式（曾泄漏成大圆块） */}
                    <span className="acct-plan">{planLabel(user.vipLevel)}</span>
                    <span className="cr">{fmt(user.points || 0)} 积分</span>
                  </div>
                  <span className="up">升级 →</span>
                </Link>

                {/* 菜单图标：emoji（彩色、跨平台不一致）→ 统一线性 SVG */}
                <div className="acct-list">
                  <Link href="/account" role="menuitem">
                    <span className="mi">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
                      </svg>
                    </span>
                    个人信息
                  </Link>
                  <Link href="/assets" role="menuitem">
                    <span className="mi">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <circle cx="8.5" cy="10" r="1.5" />
                        <path d="m21 15-4.5-4.5L9 18" />
                      </svg>
                    </span>
                    我的作品
                  </Link>
                  <Link href="/studio" role="menuitem">
                    <span className="mi">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 3l2 5.6L20 10.5l-6 1.9L12 18l-2-5.6L4 10.5l6-1.9L12 3z" />
                      </svg>
                    </span>
                    创作台
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" role="menuitem" className="admin">
                      <span className="mi">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M20 7h-7" />
                          <path d="M11 17H4" />
                          <circle cx="9" cy="7" r="3" />
                          <circle cx="15" cy="17" r="3" />
                        </svg>
                      </span>
                      管理后台
                    </Link>
                  )}
                </div>

                <div className="acct-list bord">
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={onLogout}
                  >
                    <span className="mi">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 3v9" />
                        <path d="M18.4 7a9 9 0 1 1-12.8 0" />
                      </svg>
                    </span>
                    退出登录
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <Link className="signin" href="/login">
              登录
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
