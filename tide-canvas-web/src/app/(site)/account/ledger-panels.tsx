"use client";

/* ============================================================================
   订单记录 / 积分明细 panels — shared by 个人中心 (compact: latest 5 + 「更多」
   link) and the dedicated /account/orders + /account/points pages (full:
   load-more pagination). Extracted from account/page.tsx unchanged in behavior;
   the compact/full split only affects page size and the footer control.
   ========================================================================== */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/use-auth-store";
import { orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { pointsApi, type CheckinStatusVO, type PointRecordVO } from "@/lib/points-api";
import { toast } from "@/components/shared/toast";
import { fmt } from "@/mock";
import type { OrderVO } from "@/types/billing";

/** RFC3339 → "YYYY-MM-DD HH:mm" for compact row metadata. */
function fmtTime(t?: string | null): string {
  return t ? t.slice(0, 16).replace("T", " ") : "—";
}

/* ── 订单记录 ─────────────────────────────────────────────────────────────── */

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

const ORDERS_COMPACT = 5;
const ORDERS_FULL = 15;

export function OrdersPanel({ full = false }: { full?: boolean }) {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [rows, setRows] = useState<OrderVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pageSize = full ? ORDERS_FULL : ORDERS_COMPACT;

  // load 的所有 setState 都在 .then 回调里（挂载 effect 可直接调用，不产生
  // effect 内同步 setState；首载依赖 loading 初始 true）；事件触发的拉取走
  // reload()，在事件回调里先亮 loading 再取数。
  const load = (p: number) => {
    void orderApi.list({ pageNum: p, pageSize }).then((res) => {
      setLoading(false);
      const data = res.success ? res.data : undefined;
      if (data) {
        setRows((prev) => (p === 1 ? data.records : [...prev, ...data.records]));
        setTotal(data.total);
        setPage(p);
      }
    });
  };

  const reload = (p: number) => {
    setLoading(true);
    load(p);
  };

  useEffect(() => {
    load(1);
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
      window.location.assign(res.data.payUrl);
      return;
    }
    setBusyId(null);
    if (res.success && res.data && res.data.status !== 0) {
      toast.info("订单已超时取消，请在定价页重新下单");
      reload(1);
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
      reload(1);
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
      reload(1);
    } else if (res.code === 404) {
      // 点取消的一瞬间订单已被支付/过期取消 —— 刷新列表反映最新状态即可。
      toast.info("订单状态已变更，已为你刷新");
      reload(1);
    } else {
      toast.error(res.message || "取消失败，请稍后重试");
    }
  };

  return (
    <div className="panel reveal in">
      {full ? (
        <div className="p-head">
          <h2>订单记录</h2>
          <Link className="ord-act ghost" href="/account">
            返回个人中心
          </Link>
        </div>
      ) : (
        <h2>订单记录</h2>
      )}
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

      {full
        ? rows.length < total && (
            <button
              type="button"
              className="load-more"
              disabled={loading}
              onClick={() => reload(page + 1)}
            >
              {loading ? "载入中…" : "加载更多"}
            </button>
          )
        : total > ORDERS_COMPACT && (
            <Link className="load-more" href="/account/orders">
              更多（共 {total} 条）
            </Link>
          )}
    </div>
  );
}

/* ── 积分明细（含每日签到） ───────────────────────────────────────────────── */

const CHANGE_LABEL: Record<string, string> = {
  recharge: "充值",
  consume: "消耗",
  checkin: "签到",
  reward: "奖励",
  refund: "退款",
  adjust: "调整",
};

const LEDGER_COMPACT = 5;
const LEDGER_FULL = 15;

export function PointsPanel({ full = false }: { full?: boolean }) {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [rows, setRows] = useState<PointRecordVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [checkin, setCheckin] = useState<CheckinStatusVO | null>(null);
  const [signing, setSigning] = useState(false);
  const pageSize = full ? LEDGER_FULL : LEDGER_COMPACT;

  // 同 OrdersPanel：load 的 setState 全在 .then 回调里，事件侧刷新走 reload()。
  const load = (p: number) => {
    void pointsApi.records({ pageNum: p, pageSize }).then((res) => {
      setLoading(false);
      const data = res.success ? res.data : undefined;
      if (data) {
        setRows((prev) => (p === 1 ? data.records : [...prev, ...data.records]));
        setTotal(data.total);
        setPage(p);
      }
    });
  };

  const reload = (p: number) => {
    setLoading(true);
    load(p);
  };

  useEffect(() => {
    load(1);
    pointsApi.checkinStatus().then((res) => {
      if (res.success && res.data) setCheckin(res.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capReached = !!checkin?.monthlyCapReached;

  const onCheckin = async () => {
    if (signing || checkin?.checkedToday || capReached) return;
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
      reload(1);
    } else {
      // 含月度上限拒绝：后端返回「本月签到积分已达上限（N 积分）」，直接透出。
      toast.error(res.message || "签到失败，请稍后重试");
      pointsApi.checkinStatus().then((r) => {
        if (r.success && r.data) setCheckin(r.data);
      });
    }
  };

  return (
    <div className="panel reveal in">
      <div className="p-head">
        <h2>积分明细</h2>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button
            type="button"
            className="ord-act"
            disabled={signing || !!checkin?.checkedToday || capReached}
            onClick={onCheckin}
            title={capReached && !checkin?.checkedToday ? "本月签到积分已达上限，下月恢复" : undefined}
          >
            {checkin?.checkedToday
              ? `已签到 · 连续 ${checkin.continuousDays} 天`
              : capReached
                ? "本月签到已达上限"
                : signing
                  ? "签到中…"
                  : "每日签到"}
          </button>
          {full && (
            <Link className="ord-act ghost" href="/account">
              返回个人中心
            </Link>
          )}
        </span>
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

      {full
        ? rows.length < total && (
            <button
              type="button"
              className="load-more"
              disabled={loading}
              onClick={() => reload(page + 1)}
            >
              {loading ? "载入中…" : "加载更多"}
            </button>
          )
        : total > LEDGER_COMPACT && (
            <Link className="load-more" href="/account/points">
              更多（共 {total} 条）
            </Link>
          )}
    </div>
  );
}
