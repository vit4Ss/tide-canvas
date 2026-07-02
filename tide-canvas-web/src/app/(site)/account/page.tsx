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
     - 编辑昵称 → authApi.updateProfile({ nickname }) → setUser(fresh)
     - 修改密码 → authApi.updatePassword({ oldPassword, newPassword })
     - 绑定手机·微信 → toast placeholder (needs SMS/OAuth verification flow)
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";
import { authApi } from "@/lib/api";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { toast } from "@/components/shared/toast";
import { fmt } from "@/mock";
import type { UserVO } from "@/types/user";
import "./account.css";

/* ── helpers ported from shell.js (FX.initials / FX.avatarGrad) ───────────── */

/** 密码规则与登录页保持一致(≥8 位且含字母与数字)，避免此处设的密码在登录页被拒。
    用码点计数([...v])对齐后端 rune 计数，避免星芒面字符边界不一致。 */
const isPwd = (v: string) => [...v].length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v);

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

/* ── edit-nickname modal ──────────────────────────────────────────────────── */
function NicknameModal({
  current,
  onClose,
  onSaved,
}: {
  current: string;
  onClose: () => void;
  onSaved: (u: UserVO) => void;
}) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock"); // 锁背景滚动(复用 work-modal 的 .scroll-lock 约定)
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [onClose]);

  const submit = async () => {
    if (saving) return; // 防抖:避免快速双击/连按回车并发提交(与 PasswordModal 一致)
    const nickname = value.trim();
    if (!nickname) {
      toast.error("昵称不能为空");
      return;
    }
    if (nickname === current) {
      onClose();
      return;
    }
    setSaving(true);
    const res = await authApi.updateProfile({ nickname });
    setSaving(false);
    if (res.success && res.data) {
      onSaved(res.data);
      toast.success("昵称已更新");
      onClose();
    } else {
      toast.error(res.message || "更新失败");
    }
  };

  return (
    <div
      className="acc-modal-overlay"
      onMouseDown={(e) => {
        // 仅当在遮罩自身按下并抬起时关闭；在输入框内按下、拖到遮罩上抬起(选词溢出)不应关闭并丢弃输入。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="acc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="编辑昵称"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>编辑昵称</h3>
        <p className="sub">这是其他人在社区中看到的名字。</p>
        <div className="field">
          <label>昵称</label>
          <input
            autoFocus
            value={value}
            maxLength={64}
            placeholder="输入新昵称"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="m-btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="m-btn pri"
            disabled={saving}
            onClick={submit}
          >
            {saving ? (
              <>
                <Loader2 className="inline-block mr-1.5 h-4 w-4 animate-spin" /> 保存中…
              </>
            ) : (
              "保存"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── change-password modal ────────────────────────────────────────────────── */
function PasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useFocusTrap<HTMLFormElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock"); // 锁背景滚动(复用 work-modal 的 .scroll-lock 约定)
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [onClose]);

  const submit = async () => {
    if (saving) return; // 防抖:避免快速双击并发提交
    if (!oldPassword || !newPassword) {
      toast.error("请填写完整");
      return;
    }
    if (!isPwd(newPassword)) {
      toast.error("新密码至少 8 位，包含字母与数字");
      return;
    }
    if (newPassword !== confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    const res = await authApi.updatePassword({ oldPassword, newPassword });
    setSaving(false);
    if (res.success) {
      toast.success("密码已修改");
      onClose();
    } else {
      toast.error(res.message || "修改失败,请检查原密码");
    }
  };

  return (
    <div
      className="acc-modal-overlay"
      onMouseDown={(e) => {
        // 仅当在遮罩自身按下并抬起时关闭；在输入框内按下、拖到遮罩上抬起(选词溢出)不应关闭并丢弃输入。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="acc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="修改密码"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3>修改密码</h3>
        <p className="sub">修改后需使用新密码重新登录其他设备。</p>
        <div className="field">
          <label>当前密码</label>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
          />
        </div>
        <div className="field">
          <label>新密码</label>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            placeholder="至少 8 位，含字母和数字"
            onChange={(e) => setNew(e.target.value)}
          />
        </div>
        <div className="field">
          <label>确认新密码</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="m-btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="m-btn pri" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="inline-block mr-1.5 h-4 w-4 animate-spin" /> 提交中…
              </>
            ) : (
              "确认修改"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const logout = useAuthStore((s) => s.logout);

  const [checking, setChecking] = useState(true);
  const [showNick, setShowNick] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

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
                    onClick={() => setShowNick(true)}
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
                    onClick={() => setShowPwd(true)}
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

      {showNick && (
        <NicknameModal
          current={name}
          onClose={() => setShowNick(false)}
          onSaved={(u) => setUser(u)}
        />
      )}
      {showPwd && <PasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  );
}
