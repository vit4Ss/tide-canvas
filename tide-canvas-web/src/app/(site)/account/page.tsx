"use client";

/* ============================================================================
   个人中心 · Account — React client port of design-ref/个人中心.html, wired to
   the REAL auth store / user.

   Renders inside the (site) layout (top nav + footer + flux backdrop are already
   provided), so this page emits ONLY the page content: the .page-hero header and
   the .acc-wrap sections. The liuguang class names are preserved so the shared
   flux.css + co-located account.css apply unchanged (everything scoped under the
   .acc-page wrapper).

   Auth gate (mirrors the design's `FX.authUser() || location.replace(...)`):
     ensureSession() → no token redirects to /login?redirect=/account; with a
     token it lazily loads the user via authApi.me(). While unresolved we render a
     light placeholder rather than a flash of fabricated data.

   Real data:
     - avatar initials + name = nickname || username
     - email, plan badge (vipLevel → 免费版/专业版/旗舰版/…), 管理员 badge (role 9)
     - joined = createTime (YYYY-MM), id = FX-<derived from id/email>
     - 可用积分 = user.points (REAL). 生成作品 / 获得喜欢 / 关注者 have no backing
       endpoint in this codebase (communityApi only exposes like/unlike), so they
       render as a graceful "—" instead of fabricated numbers.

   Actions:
     - 退出登录 → useAuthStore.logout() then router.push("/")
     - 编辑昵称 / 修改密码 / 绑定手机·微信 → toast placeholders (no design action)
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { fmt } from "@/mock";
import type { UserVO } from "@/types/user";
import "./account.css";

/* ── helpers ported from shell.js (FX.initials / FX.avatarGrad) ───────────── */

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

/** Stable FX-###### id, seeded from the real user id (falls back to email). */
function displayId(user: UserVO): string {
  const seed = user.id != null ? String(user.id) : user.email || "x";
  let n = 7;
  for (let i = 0; i < seed.length; i++) n = (n * 33 + seed.charCodeAt(i)) | 0;
  return "FX-" + Math.abs(n).toString().slice(0, 6).padStart(6, "0");
}

/** vipLevel → plan label (design used free/pro/team string keys). */
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

export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const logout = useAuthStore((s) => s.logout);

  const [checking, setChecking] = useState(true);

  // Auth gate: no token → ensureSession redirects to /login; with a token it
  // makes sure the user has been fetched. Mirrors the design's authUser() gate.
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await ensureSession();
      if (alive && ok) setChecking(false);
      // if !ok, ensureSession already navigated to /login — leave the placeholder up
    })();
    return () => {
      alive = false;
    };
  }, [ensureSession]);

  if (checking || !user) {
    return (
      <div className="acc-page">
        <header className="page-hero" style={{ minHeight: 240 }}>
          <div className="ph-scrim" />
          <div className="wrap">
            <div className="page-head">
              <span className="eyebrow reveal in">
                <span className="d" />
                个人中心 · ACCOUNT
              </span>
            </div>
          </div>
        </header>
        <section className="block" style={{ paddingTop: 0 }}>
          <div className="acc-wrap">
            <div className="pf-card" style={{ minHeight: 146 }}>
              <div className="pf-glow" />
              <div
                className="pf-meta"
                style={{ position: "relative", zIndex: 1 }}
              >
                正在载入账户…
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const name = user.nickname || user.username;
  const isAdmin = user.role === 9;
  const plan = planLabel(user.vipLevel);
  const isFree = !user.vipLevel; // 0 / undefined → 免费版
  const grad = avatarGrad(user.email || name);
  const joined = (user.createTime || "").slice(0, 7) || "—";

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      toast.success("已退出登录");
      router.push("/");
    }
  };

  return (
    <div className="acc-page">
      <header className="page-hero" style={{ minHeight: 240 }}>
        <div className="ph-scrim" />
        <div className="wrap">
          <div className="page-head">
            <span className="eyebrow reveal in">
              <span className="d" />
              个人中心 · ACCOUNT
            </span>
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="acc-wrap">
          {/* profile header */}
          <div className="pf-card reveal-scale in">
            <div className="pf-glow" />
            <div className="pf-av" style={{ background: grad }}>
              {initials(name)}
            </div>
            <div className="pf-id">
              <div className="pf-name">
                <span>{name}</span>
                <span className="pf-badge plan">{plan}</span>
                {isAdmin && <span className="pf-badge">管理员</span>}
              </div>
              <div className="pf-meta">
                <span>
                  <b>{user.email}</b>
                </span>
                <span>
                  注册于 <b>{joined}</b>
                </span>
                <span>
                  ID <b>{displayId(user)}</b>
                </span>
              </div>
            </div>
            <div className="pf-actions">
              <Link className="pf-btn sec" href="/assets">
                我的作品
              </Link>
              <Link className="pf-btn pri" href="/studio">
                ✦ 去创作
              </Link>
            </div>
          </div>

          {/* stats */}
          <div className="pf-stats">
            <div className="pf-stat reveal in">
              <div className="v grad">{fmt(user.points || 0)}</div>
              <div className="k">可用积分</div>
            </div>
            <div className="pf-stat reveal in">
              <div className="v">—</div>
              <div className="k">生成作品</div>
            </div>
            <div className="pf-stat reveal in">
              <div className="v">—</div>
              <div className="k">获得喜欢</div>
            </div>
            <div className="pf-stat reveal in">
              <div className="v">—</div>
              <div className="k">关注者</div>
            </div>
          </div>

          <div className="pf-grid">
            {/* account info */}
            <div className="panel reveal in">
              <h2>账户信息</h2>
              <p className="ph-note">
                管理你的登录方式与基本资料。目前仅支持邮箱登录。
              </p>
              <div className="info-row">
                <span className="lab">昵称</span>
                <span className="val">
                  <span>{name}</span>
                  <button
                    type="button"
                    className="edit"
                    onClick={() => toast.info("编辑昵称（即将开放）")}
                  >
                    编辑
                  </button>
                </span>
              </div>
              <div className="info-row">
                <span className="lab">登录邮箱</span>
                <span className="val">
                  <span>{user.email}</span>
                  <span className="verified">✓ 已验证</span>
                </span>
              </div>
              <div className="info-row">
                <span className="lab">密码</span>
                <span className="val">
                  <span>············</span>
                  <button
                    type="button"
                    className="edit"
                    onClick={() =>
                      toast.info("修改密码链接已发送至邮箱（即将开放）")
                    }
                  >
                    修改
                  </button>
                </span>
              </div>
              <div className="info-row">
                <span className="lab">手机 / 微信</span>
                <span className="val">
                  <span style={{ color: "var(--text-faint)" }}>
                    {user.phone || "未绑定"}
                  </span>
                  <button
                    type="button"
                    className="edit"
                    onClick={() => toast.info("该登录方式即将开放")}
                  >
                    即将开放
                  </button>
                </span>
              </div>

              <div className="danger-row">
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600 }}>
                    退出登录
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-faint)",
                      marginTop: 2,
                    }}
                  >
                    在此设备上结束当前会话
                  </div>
                </div>
                <button type="button" className="logout-btn" onClick={onLogout}>
                  ⏻ 退出登录
                </button>
              </div>
            </div>

            {/* plan & permissions */}
            <div className="panel reveal in">
              <h2>套餐与权限</h2>
              <p className="ph-note">
                当前套餐：<b style={{ color: "var(--text)" }}>{plan}</b>
              </p>
              <div className="perm">
                <span className="pic">✦</span>
                <div className="pt">
                  <b>标准生成</b>
                  <span>图片与视频创作</span>
                </div>
                <span className="tick">✓</span>
              </div>
              <div className="perm">
                <span className="pic">⤓</span>
                <div className="pt">
                  <b>作品下载与收藏</b>
                  <span>无限保存到资产库</span>
                </div>
                <span className="tick">✓</span>
              </div>
              <div className={`perm${!isAdmin && isFree ? " locked" : ""}`}>
                <span className="pic">⚡</span>
                <div className="pt">
                  <b>优先生成队列</b>
                  <span>高峰期免排队</span>
                </div>
                {!isAdmin && isFree ? (
                  <span className="lock">🔒</span>
                ) : (
                  <span className="tick">✓</span>
                )}
              </div>
              <div className={`perm${!isAdmin ? " locked" : ""}`}>
                <span className="pic">⚙</span>
                <div className="pt">
                  <b>管理后台</b>
                  <span>数据 · 用户 · 内容审核</span>
                </div>
                {isAdmin ? (
                  <span className="tick">✓</span>
                ) : (
                  <span className="lock">🔒</span>
                )}
              </div>

              {isAdmin ? (
                <div className="admin-cta">
                  <span className="ai">⚙</span>
                  <div className="at">
                    <b>你拥有管理权限</b>
                    <span>进入后台查看运营数据</span>
                  </div>
                  <Link href="/admin">进入后台</Link>
                </div>
              ) : (
                <Link
                  className="pf-btn pri"
                  href="/pricing"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    marginTop: 18,
                  }}
                >
                  升级解锁更多权益 →
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
