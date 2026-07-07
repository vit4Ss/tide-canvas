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
     - stats are all REAL: 可用积分 = user.points; 创作资产 / 创作项目 = the
       /api/files and /api/projects paged totals (pageSize=1 probe); 连续签到 =
       /api/points/checkin streak. The former 获得喜欢 / 关注者 placeholders were
       dropped — no social endpoints exist, and we don't fabricate numbers.

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
import { authApi, fileApi, projectApi } from "@/lib/api";
import { orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { pointsApi, type CheckinStatusVO, type PointRecordVO } from "@/lib/points-api";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { toast } from "@/components/shared/toast";
import { fmt } from "@/mock";
import { grayscaleSwatch } from "@/lib/swatch";
import type { OrderVO } from "@/types/billing";
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
  return grayscaleSwatch(seed || "u");
}

/** Stable FX-###### id, seeded from the real user id (falls back to email). */
function displayId(user: UserVO): string {
  const seed = user.id != null ? String(user.id) : user.email || "x";
  let n = 7;
  for (let i = 0; i < seed.length; i++) n = (n * 33 + seed.charCodeAt(i)) | 0;
  return "FX-" + Math.abs(n).toString().slice(0, 6).padStart(6, "0");
}

/** vipLevel → plan label. Levels align with the billing seeds
    (pro → 1, enterprise → 2; see billing/service.go vipForPlan). */
function planLabel(vipLevel?: number): string {
  switch (vipLevel) {
    case 1:
      return "专业版";
    case 2:
      return "企业版";
    case 3:
      return "旗舰版";
    default:
      return "免费版";
  }
}

/** RFC3339 → "YYYY-MM-DD HH:mm" for compact row metadata. */
function fmtTime(t?: string | null): string {
  return t ? t.slice(0, 16).replace("T", " ") : "—";
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

/* ── 账户统计 ─────────────────────────────────────────────────────────────── */

/** All four stats come from real endpoints: points from the user object,
    资产/项目 from the paged lists' total (pageSize=1 probe), 连续签到 from the
    check-in status. No fabricated social numbers. */
function AccountStats({ points }: { points: number }) {
  const [assets, setAssets] = useState<number | null>(null);
  const [projects, setProjects] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fileApi.list({ pageNum: 1, pageSize: 1 }).then((res) => {
      if (alive && res.success && res.data) setAssets(res.data.total);
    });
    projectApi.list({ pageNum: 1, pageSize: 1 }).then((res) => {
      if (alive && res.success && res.data) setProjects(res.data.total);
    });
    pointsApi.checkinStatus().then((res) => {
      if (alive && res.success && res.data) setStreak(res.data.continuousDays);
    });
    return () => {
      alive = false;
    };
  }, []);

  const num = (v: number | null) => (v == null ? "—" : fmt(v));
  return (
    <div className="pf-stats">
      <div className="pf-stat reveal in">
        <div className="v grad">{fmt(points || 0)}</div>
        <div className="k">可用积分</div>
      </div>
      <div className="pf-stat reveal in">
        <div className="v">{num(assets)}</div>
        <div className="k">创作资产</div>
      </div>
      <div className="pf-stat reveal in">
        <div className="v">{num(projects)}</div>
        <div className="k">创作项目</div>
      </div>
      <div className="pf-stat reveal in">
        <div className="v">{streak == null ? "—" : `${streak} 天`}</div>
        <div className="k">连续签到</div>
      </div>
    </div>
  );
}

/* ── 订单记录 panel ────────────────────────────────────────────────────────── */

const ORDER_STATUS: Record<number, { label: string; cls: string }> = {
  0: { label: "待支付", cls: "pending" },
  1: { label: "已支付", cls: "paid" },
  2: { label: "已取消", cls: "cancel" },
  3: { label: "已退款", cls: "refund" },
};

/** Order display title from its type + billing cycle. */
function orderTitle(o: OrderVO): string {
  if (o.type === "plan") {
    return o.cycle === "yearly" ? "会员套餐（年付）" : "会员套餐（月付）";
  }
  return "积分充值包";
}

/** Minutes left before the checkout deadline; null when无期限信息, 0 = 已超时. */
function remainMinutes(expire?: string | null): number | null {
  if (!expire) return null;
  const ms = new Date(expire).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

const ORDERS_PAGE = 5;

function OrdersPanel() {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [rows, setRows] = useState<OrderVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (p: number) => {
    setLoading(true);
    const res = await orderApi.list({ pageNum: p, pageSize: ORDERS_PAGE });
    setLoading(false);
    const data = res.success ? res.data : undefined;
    if (data) {
      setRows((prev) => (p === 1 ? data.records : [...prev, ...data.records]));
      setTotal(data.total);
      setPage(p);
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 继续支付: fetch the order detail — the server regenerates a fresh cashier
  // URL for a still-payable order — persist the pending id for the /billing
  // return page, then redirect. An expired order comes back as 已取消 with no
  // URL (the server lazily flips it), so tell the user to re-order.
  const onContinue = async (o: OrderVO) => {
    if (busyId) return;
    setBusyId(o.id);
    const res = await orderApi.get(o.id);
    if (res.success && res.data?.payUrl) {
      try {
        localStorage.setItem(PENDING_ORDER_KEY, o.id);
      } catch {
        /* verify also accepts ?orderId= */
      }
      window.location.href = res.data.payUrl;
      return;
    }
    setBusyId(null);
    if (res.success && res.data && res.data.status !== 0) {
      toast.info("订单已超时取消，请在定价页重新下单");
      void load(1);
      return;
    }
    toast.error("支付通道暂不可用，请稍后再试");
  };

  // 核对到账: return_url backstop for users who paid but closed the cashier
  // before redirecting back — queries the gateway and credits idempotently.
  const onVerify = async (o: OrderVO) => {
    if (busyId) return;
    setBusyId(o.id);
    const res = await orderApi.verify(o.id);
    setBusyId(null);
    if (res.success && res.data?.paid) {
      toast.success("已确认支付，积分已到账");
      fetchUser();
      void load(1);
    } else if (res.success) {
      toast.info("暂未查询到支付结果，若已付款请稍后再试");
    } else {
      toast.error(res.message || "查询失败，请稍后重试");
    }
  };

  const onCancel = async (o: OrderVO) => {
    if (busyId) return;
    setBusyId(o.id);
    const res = await orderApi.cancel(o.id);
    setBusyId(null);
    if (res.success) {
      toast.success("订单已取消");
      void load(1);
    } else if (res.code === 404) {
      // 点取消的一瞬间订单已被支付/过期取消 —— 刷新列表反映最新状态即可。
      toast.info("订单状态已变更，已为你刷新");
      void load(1);
    } else {
      toast.error(res.message || "取消失败，请稍后重试");
    }
  };

  return (
    <div className="panel reveal in">
      <h2>订单记录</h2>
      <p className="ph-note">会员订阅与积分充值的购买记录。</p>

      {rows.length === 0 && (
        <div className="empty-note">
          {loading ? "正在载入…" : "暂无订单。购买套餐或积分包后会显示在这里。"}
        </div>
      )}

      {rows.map((o) => {
        const st = ORDER_STATUS[o.status] ?? { label: "未知", cls: "cancel" };
        const busy = busyId === o.id;
        const left = o.status === 0 ? remainMinutes(o.expireTime) : null;
        return (
          <div className="ledger-row" key={o.id}>
            <div className="lr-main">
              <div className="lr-title">
                {orderTitle(o)}
                <span className={`ord-status ${st.cls}`}>{st.label}</span>
              </div>
              <div className="lr-meta">
                {o.orderNo} · {fmtTime(o.createTime)}
                {left != null && (left > 0 ? ` · 剩余 ${left} 分钟` : " · 已超时")}
              </div>
            </div>
            <div className="lr-side">
              <span className="lr-amt">¥{o.amount}</span>
              {o.status === 0 && (
                <span className="ord-acts">
                  <button
                    type="button"
                    className="ord-act"
                    disabled={busy}
                    onClick={() => onContinue(o)}
                  >
                    继续支付
                  </button>
                  <button
                    type="button"
                    className="ord-act ghost"
                    disabled={busy}
                    onClick={() => onVerify(o)}
                  >
                    核对到账
                  </button>
                  <button
                    type="button"
                    className="ord-act ghost"
                    disabled={busy}
                    onClick={() => onCancel(o)}
                  >
                    取消
                  </button>
                </span>
              )}
              {/* 已取消/已超时的订单也保留「核对到账」——用户可能在过期后
                  才于残留的收银台页面完成付款（后端会照常入账）。 */}
              {o.status === 2 && (
                <span className="ord-acts">
                  <button
                    type="button"
                    className="ord-act ghost"
                    disabled={busy}
                    onClick={() => onVerify(o)}
                  >
                    核对到账
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}

      {rows.length < total && (
        <button
          type="button"
          className="load-more"
          disabled={loading}
          onClick={() => load(page + 1)}
        >
          {loading ? "载入中…" : "加载更多"}
        </button>
      )}
    </div>
  );
}

/* ── 积分明细 panel（含每日签到） ─────────────────────────────────────────── */

const CHANGE_LABEL: Record<string, string> = {
  recharge: "充值",
  consume: "消耗",
  checkin: "签到",
  reward: "奖励",
  refund: "退款",
  adjust: "调整",
};

const LEDGER_PAGE = 8;

function PointsPanel() {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [rows, setRows] = useState<PointRecordVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [checkin, setCheckin] = useState<CheckinStatusVO | null>(null);
  const [signing, setSigning] = useState(false);

  const load = async (p: number) => {
    setLoading(true);
    const res = await pointsApi.records({ pageNum: p, pageSize: LEDGER_PAGE });
    setLoading(false);
    const data = res.success ? res.data : undefined;
    if (data) {
      setRows((prev) => (p === 1 ? data.records : [...prev, ...data.records]));
      setTotal(data.total);
      setPage(p);
    }
  };

  useEffect(() => {
    void load(1);
    pointsApi.checkinStatus().then((res) => {
      if (res.success && res.data) setCheckin(res.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCheckin = async () => {
    if (signing || checkin?.checkedToday) return;
    setSigning(true);
    const res = await pointsApi.checkin();
    setSigning(false);
    if (res.success && res.data) {
      if (res.data.rewarded) {
        toast.success(`签到成功，+${res.data.points} 积分`);
      } else {
        toast.info("今天已经签到过了");
      }
      setCheckin({ checkedToday: true, continuousDays: res.data.continuousDays });
      fetchUser();
      void load(1);
    } else {
      toast.error(res.message || "签到失败，请稍后重试");
    }
  };

  return (
    <div className="panel reveal in">
      <div className="p-head">
        <h2>积分明细</h2>
        <button
          type="button"
          className="ord-act"
          disabled={signing || !!checkin?.checkedToday}
          onClick={onCheckin}
        >
          {checkin?.checkedToday
            ? `已签到 · 连续 ${checkin.continuousDays} 天`
            : signing
              ? "签到中…"
              : "每日签到"}
        </button>
      </div>
      <p className="ph-note">充值、签到与生成消耗的积分流水。</p>

      {rows.length === 0 && (
        <div className="empty-note">
          {loading ? "正在载入…" : "暂无积分流水。"}
        </div>
      )}

      {rows.map((r) => {
        const gain = r.amount > 0;
        return (
          <div className="ledger-row" key={r.id}>
            <div className="lr-main">
              <div className="lr-title">
                {r.remark || CHANGE_LABEL[r.changeType] || r.changeType}
              </div>
              <div className="lr-meta">
                {CHANGE_LABEL[r.changeType] || r.changeType} · {fmtTime(r.createTime)} · 余额{" "}
                {fmt(r.balance)}
              </div>
            </div>
            <span className={`lr-amt ${gain ? "gain" : "spend"}`}>
              {gain ? "+" : ""}
              {fmt(r.amount)}
            </span>
          </div>
        );
      })}

      {rows.length < total && (
        <button
          type="button"
          className="load-more"
          disabled={loading}
          onClick={() => load(page + 1)}
        >
          {loading ? "载入中…" : "加载更多"}
        </button>
      )}
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

          {/* stats — all real, no social placeholders */}
          <AccountStats points={user.points || 0} />

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

          {/* billing: purchase history + points ledger (real endpoints) */}
          <div className="pf-grid">
            <OrdersPanel />
            <PointsPanel />
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
