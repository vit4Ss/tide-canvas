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

   未支付/慢结算路径: polling exhausts → "支付确认中" with a 重新核对 button
   (re-runs the same idempotent verify), plus the async notify and the account
   page's 核对到账 as further backstops — a paid order can never be lost, an
   unpaid one just stays pending until it lazily expires server-side.

   Renders inside the (site) layout (nav + footer + flux backdrop provided), so
   it emits only the result card.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { orderApi, PENDING_ORDER_KEY } from "@/lib/billing-api";
import { useAuthStore } from "@/stores/use-auth-store";

type Phase = "verifying" | "granted" | "pending" | "none" | "error";

const MAX_TRIES = 6;
const RETRY_MS = 1500;
// 整体核对预算：后端查网关单次最多 15s，6 轮最坏要 1 分多钟——观感即“卡死”。
// 超过预算直接转入「支付确认中」，用户可点「重新核对」，异步回调也会兜底。
const DEADLINE_MS = 20_000;

/** Pending order id: ?orderId= wins, else the PayModal-persisted key. */
function resolveOrderId(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("orderId");
  if (fromQuery) return fromQuery;
  try {
    return localStorage.getItem(PENDING_ORDER_KEY) || "";
  } catch {
    return "";
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    /* ignore */
  }
}

export default function BillingReturnPage() {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [phase, setPhase] = useState<Phase>("verifying");
  const ranRef = useRef(false);
  const busyRef = useRef(false);

  // Poll verify until paid or the tries run out. Idempotent server-side, so
  // both the auto-run and the manual 重新核对 can call it freely.
  const runVerify = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("verifying");
    try {
      const orderId = resolveOrderId();
      if (!orderId) {
        setPhase("none");
        return;
      }
      const startedAt = Date.now();
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const res = await orderApi.verify(orderId);
        if (res.success && res.data?.paid) {
          clearPending();
          // Credits landed (either this call granted them or the async notify
          // already did) — refresh the user so the balance updates.
          await fetchUser();
          setPhase("granted");
          return;
        }
        if (!res.success && (res.code === 401 || res.code === 403)) {
          setPhase("error");
          return;
        }
        // 超过整体预算即止损：转入可手动重试的「支付确认中」。
        if (Date.now() - startedAt > DEADLINE_MS) {
          break;
        }
        // Not paid yet (settlement lag) — wait and retry.
        if (attempt < MAX_TRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
      // Exhausted retries without a paid result: leave the pending key so 重新
      // 核对 / the async notify / the account page can still settle it.
      setPhase("pending");
    } finally {
      busyRef.current = false;
    }
  }, [fetchUser]);

  useEffect(() => {
    // Guard against React 18 StrictMode double-invoke in dev.
    if (ranRef.current) return;
    ranRef.current = true;
    void runVerify();
  }, [runVerify]);

  return (
    <div className="block page-top">
      <div className="wrap" style={{ maxWidth: 560 }}>
        {/* imini 语言：深色面板 + 细边框，零彩色（旧版误用浅色主题的
            --card/--accent 变量，纯黑主题下渲染成白底紫图标）。 */}
        <div
          style={{
            margin: "40px auto 72px",
            padding: "48px 36px",
            textAlign: "center",
            borderRadius: 16,
            border: "1px solid var(--border, rgba(255,255,255,.1))",
            background: "var(--surface, #131316)",
          }}
        >
          <Result phase={phase} onRetry={runVerify} />
        </div>
      </div>
    </div>
  );
}

function Result({ phase, onRetry }: { phase: Phase; onRetry: () => void }) {
  // 零彩色：成功用主文字白，其余用弱化灰；spinner 是功能性进度指示。
  const icon = {
    verifying: (
      <Loader2 size={34} className="animate-spin" style={{ color: "var(--text-dim, #aaa)" }} />
    ),
    granted: <CheckCircle2 size={34} style={{ color: "var(--text, #fff)" }} />,
    pending: <Clock size={34} style={{ color: "var(--text-dim, #aaa)" }} />,
    none: <Clock size={34} style={{ color: "var(--text-faint, #888)" }} />,
    error: <XCircle size={34} style={{ color: "var(--text-dim, #aaa)" }} />,
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
    pending:
      "尚未查询到你的付款。若已完成付款，可点击「重新核对」，积分也会在网关回调后自动到账；若未付款，订单将在 30 分钟后自动取消，可随时在定价页重新购买。",
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
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 28,
          }}
        >
          {phase === "pending" && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "10px 20px",
                borderRadius: "var(--pill, 10px)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text, #fff)",
                background: "transparent",
                border: "1px solid var(--border-strong, rgba(255,255,255,.2))",
                cursor: "pointer",
              }}
            >
              重新核对
            </button>
          )}
          <Link
            href="/account"
            style={{
              padding: "10px 20px",
              borderRadius: "var(--pill, 10px)",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text, #fff)",
              border: "1px solid var(--border-strong, rgba(255,255,255,.2))",
              textDecoration: "none",
            }}
          >
            前往账户
          </Link>
          <Link
            href="/studio"
            style={{
              padding: "10px 20px",
              borderRadius: "var(--pill, 10px)",
              fontSize: 14,
              color: "var(--text-dim, #aab)",
              border: "1px solid var(--border, rgba(255,255,255,.14))",
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
