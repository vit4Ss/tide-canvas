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
import {
  useFluxBgStore,
  FLUX_PRESETS,
  FLUX_PRESET_ORDER,
} from "@/stores/use-flux-bg-store";
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
  return `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${(h + 48) % 360} 72% 56%))`;
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
  const bgRef = useRef<HTMLDivElement>(null);
  const { user, isAdmin } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const preset = useFluxBgStore((s) => s.preset);
  const setPreset = useFluxBgStore((s) => s.setPreset);
  const [open, setOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);

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

  // 流光背景 switcher: close on outside-click / Escape (mirrors bindBgSwitcher)
  useEffect(() => {
    if (!bgOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bgRef.current && !bgRef.current.contains(e.target as Node)) {
        setBgOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBgOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [bgOpen]);

  // close menus on navigation
  useEffect(() => {
    setOpen(false);
    setBgOpen(false);
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

          {/* 流光背景切换器 — ported from home-render.buildBgSwitcher().
              The orb shows the active preset's gradient; clicking opens the
              背景 popup, selecting a preset retunes the WebGL field + persists. */}
          <div className={`bg-nav${bgOpen ? " open" : ""}`} ref={bgRef}>
            <button
              type="button"
              className="icbtn bg-nav-btn"
              title="背景流光"
              aria-label="切换背景"
              onClick={(e) => {
                e.stopPropagation();
                setBgOpen((v) => !v);
              }}
            >
              <span
                className="bg-orb"
                style={{ background: FLUX_PRESETS[preset].sw }}
              />
            </button>
            <div className="bg-nav-pop">
              <div className="bg-switch-head">流光背景</div>
              <div className="bg-switch-grid">
                {FLUX_PRESET_ORDER.map((key) => {
                  const p = FLUX_PRESETS[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className="bg-opt"
                      aria-current={preset === key}
                      onClick={() => {
                        setPreset(key);
                        setBgOpen(false);
                      }}
                    >
                      <span
                        className="bg-opt-sw"
                        style={{ background: p.sw }}
                      />
                      <span className="bg-opt-tx">
                        <b>{p.label}</b>
                        <i>{p.sub}</i>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

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
                    <span className="plan">{planLabel(user.vipLevel)}</span>
                    <span className="cr">{fmt(user.points || 0)} 积分</span>
                  </div>
                  <span className="up">升级 →</span>
                </Link>

                <div className="acct-list">
                  <Link href="/account" role="menuitem">
                    <span className="mi">👤</span>个人信息
                  </Link>
                  <Link href="/assets" role="menuitem">
                    <span className="mi">🖼</span>我的作品
                  </Link>
                  <Link href="/studio" role="menuitem">
                    <span className="mi">✦</span>创作台
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" role="menuitem" className="admin">
                      <span className="mi">⚙</span>管理后台
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
                    <span className="mi">⏻</span>退出登录
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
