"use client";

/* ============================================================================
   PayModal — pay-method chooser that starts an epay checkout.

   Given a purchase intent (a plan or a point package + display name + amount)
   it lets the user pick 支付宝 / 微信, creates the order via orderApi.create,
   persists the pending order id (so the /billing return page can verify it),
   and redirects the browser to the epay page-jump cashier (order.payUrl).

   The caller is responsible for gating auth before opening this (a checkout
   requires a session). Styling stays minimal and theme-driven (CSS vars) so it
   sits quietly inside the liuguang shell.
   ========================================================================== */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { toast } from "@/components/shared/toast";
import type { CreateOrderDTO, PayChannel } from "@/types/billing";

export interface PurchaseIntent {
  type: "plan" | "point_package";
  planId?: string;
  packageId?: string;
  /** Display name shown in the modal (plan / package name). */
  name: string;
  /** Amount in CNY for display only — the server prices the order. */
  amount: number;
}

const CHANNELS: { key: PayChannel; label: string; icon: string }[] = [
  { key: "alipay", label: "支付宝", icon: "支" },
  { key: "wxpay", label: "微信支付", icon: "微" },
];

export default function PayModal({
  intent,
  onClose,
}: {
  intent: PurchaseIntent;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<PayChannel>("alipay");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [onClose, submitting]);

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    const dto: CreateOrderDTO = {
      type: intent.type,
      payChannel: channel,
      ...(intent.type === "plan"
        ? { planId: intent.planId }
        : { packageId: intent.packageId }),
    };
    const res = await orderApi.create(dto);
    if (res.success && res.data?.payUrl) {
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
    toast.error(res.message || "创建订单失败，请稍后重试");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择支付方式"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(8,10,18,.62)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          borderRadius: 16,
          border: "1px solid var(--line, rgba(255,255,255,.1))",
          background: "var(--card, #14161f)",
          boxShadow: "0 20px 60px rgba(0,0,0,.4)",
          padding: 24,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text, #fff)" }}>
          确认订单
        </h3>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            margin: "16px 0 20px",
            paddingBottom: 16,
            borderBottom: "1px solid var(--line, rgba(255,255,255,.08))",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--text-dim, #aab)" }}>{intent.name}</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text, #fff)" }}>
            ¥{intent.amount}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-dim, #aab)", marginBottom: 10 }}>
          选择支付方式
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {CHANNELS.map((c) => {
            const on = channel === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  cursor: "pointer",
                  border: on
                    ? "1.5px solid var(--brand, #6b5bff)"
                    : "1px solid var(--line, rgba(255,255,255,.12))",
                  background: on ? "var(--brand-soft, rgba(107,91,255,.1))" : "transparent",
                  color: "var(--text, #fff)",
                  transition: "border-color .16s ease, background .16s ease",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#fff",
                    background: c.key === "alipay" ? "#1677ff" : "#07c160",
                  }}
                >
                  {c.icon}
                </span>
                <span style={{ fontSize: 14 }}>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: "0 0 auto",
              padding: "11px 18px",
              borderRadius: 10,
              border: "1px solid var(--line, rgba(255,255,255,.14))",
              background: "transparent",
              color: "var(--text-dim, #aab)",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 14,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "11px 18px",
              borderRadius: 10,
              border: "none",
              background: "var(--brand, #6b5bff)",
              color: "#fff",
              cursor: submitting ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
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

        <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--text-faint, #778)", lineHeight: 1.5 }}>
          将跳转至第三方收银台完成支付。支付完成后请返回本站，积分将自动到账。
        </p>
      </div>
    </div>
  );
}
