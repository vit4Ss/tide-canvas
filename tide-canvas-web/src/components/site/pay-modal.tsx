"use client";

/* ============================================================================
   PayModal — pay-method chooser that starts an epay checkout.

   Given a purchase intent (a plan + billing cycle + display name + amount) it
   lets the user pick 支付宝 / 微信, creates the order via orderApi.create,
   persists the pending order id (so the /billing return page can verify it),
   and redirects the browser to the epay page-jump cashier (order.payUrl).
   积分只随套餐发放——单独的积分包购买通道已下线（产品决策，2026-07）。

   The caller is responsible for gating auth before opening this (a checkout
   requires a session). Styling lives in the co-located pay-modal.css and uses
   only the liuguang theme tokens (flux / imini), mirroring .acc-modal.
   ========================================================================== */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { billingApi, orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import type { BillCycle, CreateOrderDTO, PayChannel, PayChannelVO } from "@/types/billing";
import "./pay-modal.css";

export interface PurchaseIntent {
  planId: string;
  /** Billing cycle; forwarded to the order (server prices from it). */
  cycle: BillCycle;
  /** Display name shown in the modal (plan name). */
  name: string;
  /** Amount in CNY for display only — the server prices the order. */
  amount: number;
  /** Optional price breakdown shown under the amount (e.g. "¥39/月 × 12 个月"). */
  amountNote?: string;
}

/** Icon glyphs per epay key; names come from the admin channel rows. */
const CHANNEL_ICON: Record<PayChannel, string> = { alipay: "支", wxpay: "微" };

export default function PayModal({
  intent,
  onClose,
}: {
  intent: PurchaseIntent;
  onClose: () => void;
}) {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [channel, setChannel] = useState<PayChannel | null>(null);
  // null = loading; [] = admin disabled every channel (checkout closed).
  const [channels, setChannels] = useState<PayChannelVO[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 服务端实际定价与展示价不一致时（页面停留恰好跨过限时活动开始/结束点）
  // 记录服务端金额：不跳收银台，改为更新弹窗金额并提示，用户确认后再支付。
  const [serverAmount, setServerAmount] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [onClose, submitting]);

  // 从收银台按「返回」回来时，页面从 bfcache 原样恢复，冻结的 submitting=true
  // 会把按钮永远卡在「正在跳转…」。pageshow(persisted) 是唯一的恢复时机：
  // 解锁按钮，并顺手核对一次挂起订单——用户可能已完成支付才按的返回。
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setSubmitting(false);
      let pending = "";
      try {
        pending = localStorage.getItem(PENDING_ORDER_KEY) || "";
      } catch {
        /* ignore */
      }
      if (!pending) return;
      void orderApi.verify(pending).then((res) => {
        if (res.success && res.data?.paid) {
          try {
            localStorage.removeItem(PENDING_ORDER_KEY);
          } catch {
            /* ignore */
          }
          toast.success("支付成功，积分已到账");
          fetchUser();
          onClose();
        }
      });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [onClose, fetchUser]);

  // Available pay methods are the admin 支付渠道 configuration, not a
  // hard-coded list. Default-select the first enabled one.
  useEffect(() => {
    let alive = true;
    billingApi.channels().then((res) => {
      if (!alive) return;
      const list = res.success && res.data ? res.data : [];
      setChannels(list);
      setChannel(list[0]?.key ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const confirm = async () => {
    if (submitting || !channel) return;
    setSubmitting(true);
    const dto: CreateOrderDTO = {
      type: "plan",
      planId: intent.planId,
      cycle: intent.cycle,
      payChannel: channel,
    };
    const res = await orderApi.create(dto);
    if (res.success && res.data?.payUrl) {
      // 价格一致性防护：订单以服务端定价为准（限时活动由服务端时钟裁决）。
      // 与当前展示价对不上时先亮新价，不带着用户跳到金额不同的收银台。
      const priced = Number(res.data.amount);
      const shown = serverAmount ?? intent.amount;
      if (Number.isFinite(priced) && Math.abs(priced - shown) >= 0.01) {
        setServerAmount(priced);
        setSubmitting(false);
        toast.error(`价格已按最新活动状态更新为 ¥${priced}，请确认后再支付`);
        return;
      }
      // Persist the order id so the /billing return page can verify + credit it
      // even if the gateway's async notify is delayed or dropped.
      try {
        localStorage.setItem(PENDING_ORDER_KEY, res.data.id);
      } catch {
        // ignore storage failures — verify also accepts an ?orderId= fallback.
      }
      window.location.href = res.data.payUrl;
      return;
    }
    setSubmitting(false);
    // The order row may exist but the gateway is off/unreachable — tell the
    // user precisely instead of a generic create failure.
    if (res.success && res.data && !res.data.payUrl) {
      toast.error("支付通道暂未开通，请稍后再试或联系客服");
      return;
    }
    toast.error(res.message || "创建订单失败，请稍后重试");
  };

  return (
    <div
      className="pm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="选择支付方式"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="pm" onClick={(e) => e.stopPropagation()}>
        <h3>确认订单</h3>

        <div className="pm-line">
          <span className="pm-name">{intent.name}</span>
          <span className="pm-price">
            <span className="pm-amt">¥{serverAmount ?? intent.amount}</span>
            {/* 金额被服务端修正后，原价格拆解说明已失真，不再展示 */}
            {serverAmount == null && intent.amountNote && (
              <span className="pm-note">{intent.amountNote}</span>
            )}
          </span>
        </div>

        <div className="pm-sub">选择支付方式</div>
        {channels === null ? (
          <div className="pm-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在载入支付方式…
          </div>
        ) : channels.length === 0 ? (
          <div className="pm-empty">支付通道暂未开通，请稍后再试或联系客服。</div>
        ) : (
          <div className="pm-channels">
            {channels.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`pm-ch${channel === c.key ? " on" : ""}`}
                onClick={() => setChannel(c.key)}
              >
                <span aria-hidden className={`ic ${c.key}`}>
                  {CHANNEL_ICON[c.key] ?? c.name.slice(0, 1)}
                </span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="pm-actions">
          <button
            type="button"
            className="pm-btn ghost"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="pm-btn pri"
            onClick={confirm}
            disabled={submitting || !channel}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 正在跳转…
              </>
            ) : (
              "立即支付"
            )}
          </button>
        </div>

        <p className="pm-tip">
          将跳转至第三方收银台完成支付。支付完成后请返回本站，积分将自动到账。
        </p>
      </div>
    </div>
  );
}
