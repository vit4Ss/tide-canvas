"use client";

/* ============================================================================
   支付结果 · Billing return — the epay return_url landing.

   After the user pays at the third-party cashier the gateway redirects the
   browser here (app.eliandapay.return-url = /billing?pay_status=success). This
   page is the client-side backstop for a delayed/dropped async notify: it reads
   the pending order id (persisted by PayModal before the redirect, with an
   ?orderId= query fallback) and polls POST /api/orders/:id/verify, which queries
   the gateway and credits the order idempotently. On success it refreshes the
   user so the new points balance shows immediately.

   Renders inside the (site) layout (nav + footer + flux backdrop provided), so
   it emits only the result card.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { useAuthStore } from "@/stores/use-auth-store";

type Phase = "verifying" | "granted" | "pending" | "none" | "error";

const MAX_TRIES = 6;
const RETRY_MS = 1500;

export default function BillingReturnPage() {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [phase, setPhase] = useState<Phase>("verifying");
  const ranRef = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode double-invoke in dev.
    if (ranRef.current) return;
    ranRef.current = true;

    let alive = true;
    const clearPending = () => {
      try {
        localStorage.removeItem(PENDING_ORDER_KEY);
      } catch {
        /* ignore */
      }
    };

    const resolveOrderId = (): string => {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get("orderId");
      if (fromQuery) return fromQuery;
      try {
        return localStorage.getItem(PENDING_ORDER_KEY) || "";
      } catch {
        return "";
      }
    };

    (async () => {
      const orderId = resolveOrderId();
      if (!orderId) {
        if (alive) setPhase("none");
        return;
      }
      for (let attempt = 0; attempt < MAX_TRIES && alive; attempt++) {
        const res = await orderApi.verify(orderId);
        if (!alive) return;
        if (res.success && res.data) {
          if (res.data.paid) {
            clearPending();
            // Credits landed (either this call granted them or the async notify
            // already did) — refresh the user so the balance updates.
            await fetchUser();
            if (alive) setPhase("granted");
            return;
          }
        } else if (res.code === 401 || res.code === 403) {
          if (alive) setPhase("error");
          return;
        }
        // Not paid yet (settlement lag) — wait and retry.
        if (attempt < MAX_TRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
      // Exhausted retries without a paid result: leave the pending key so a later
      // manual re-check (or the async notify) can still settle it.
      if (alive) setPhase("pending");
    })();

    return () => {
      alive = false;
    };
  }, [fetchUser]);

  return (
    <div className="block page-top">
      <div className="wrap" style={{ maxWidth: 620 }}>
        <div
          style={{
            margin: "40px auto",
            padding: "40px 32px",
            textAlign: "center",
            borderRadius: 16,
            border: "1px solid var(--line, rgba(255,255,255,.1))",
            background: "var(--card, rgba(255,255,255,.03))",
          }}
        >
          <Result phase={phase} />
        </div>
      </div>
    </div>
  );
}

function Result({ phase }: { phase: Phase }) {
  const icon = {
    verifying: <Loader2 className="h-10 w-10 animate-spin" style={{ color: "var(--brand, #6b5bff)" }} />,
    granted: <CheckCircle2 className="h-10 w-10" style={{ color: "#22c55e" }} />,
    pending: <Clock className="h-10 w-10" style={{ color: "#f59e0b" }} />,
    none: <Clock className="h-10 w-10" style={{ color: "var(--text-dim, #99a)" }} />,
    error: <XCircle className="h-10 w-10" style={{ color: "#ef4444" }} />,
  }[phase];

  const title = {
    verifying: "正在确认支付结果…",
    granted: "支付成功",
    pending: "支付确认中",
    none: "没有待确认的订单",
    error: "无法确认支付",
  }[phase];

  const desc = {
    verifying: "请稍候，正在向支付网关核对订单状态。",
    granted: "积分已到账，感谢你的支持！",
    pending: "支付可能仍在处理中。若你已完成付款，积分将在稍后自动到账，可稍后在账户中查看。",
    none: "未找到需要确认的订单。如果你刚完成支付，请从账户页查看订单记录。",
    error: "请登录后在账户页查看订单状态，或联系客服。",
  }[phase];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>{icon}</div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text, #fff)" }}>
        {title}
      </h1>
      <p
        style={{
          margin: "12px auto 0",
          maxWidth: "46ch",
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "var(--text-dim, #aab)",
        }}
      >
        {desc}
      </p>

      {phase !== "verifying" && (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28 }}>
          <Link
            href="/account"
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "var(--brand, #6b5bff)",
              textDecoration: "none",
            }}
          >
            前往账户
          </Link>
          <Link
            href="/studio"
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              fontSize: 14,
              color: "var(--text-dim, #aab)",
              border: "1px solid var(--line, rgba(255,255,255,.14))",
              textDecoration: "none",
            }}
          >
            去创作
          </Link>
        </div>
      )}
    </>
  );
}
