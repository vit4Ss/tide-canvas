"use client";
import { SupportLink } from "./consumer-info";
import { useBrand } from "./runtime-config";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Check, CreditCard } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, PageHeading, RequireAccount } from "./ui";
import { useResource } from "@/lib/use-resource";
import { orderApi } from "@/lib/api";
import { date, number } from "@/lib/brand";
import { checkoutUrl } from "@/lib/billing";
import type { OrderVO } from "@/types/billing";

export default function Billing() {
  const query = useSearchParams();
  const { user } = useAuth();
  const id = query.get("order") || "";
  return <BillingOrder key={`${user?.id || "signed-out"}:${id}`} id={id} returned={query.get("checkout") || ""} existing={query.get("existing") === "1"} review={query.get("review") === "1"} />;
}

function BillingOrder({ id, returned, existing, review }: { id: string; returned: string; existing: boolean; review: boolean }) {
  const { money } = useBrand();
  const { user, refresh, sessionVersion } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const order = useResource<OrderVO>(`/api/orders/${encodeURIComponent(id)}`, !!user && !!id, user?.id);
  const refreshOrder = order.refresh;
  useEffect(() => () => operation.current?.abort(), []);

  const verify = useCallback(async (automatic = false) => {
    if (!user || !id || operation.current) return false;
    const controller = new AbortController(); operation.current = controller;
    const version = sessionVersion();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    setBusy(true); setError("");
    const result = await orderApi.verify(id, controller.signal);
    clearTimeout(timeout);
    if (operation.current !== controller) return false;
    operation.current = null; setBusy(false);
    if (sessionVersion() !== version) { setError("Your sign-in was updated. Check payment status again."); return false; }
    if (controller.signal.aborted) { setError("Payment status could not be checked. Try again; do not pay a second time."); return false; }
    if (!result.success) { setError(result.message); return false; }
    if (typeof result.data?.paid !== "boolean" || typeof result.data?.granted !== "boolean") { setError("The payment response was incomplete. Check again before making another payment."); return false; }
    if (result.data.paid) {
      setConfirmed(true); setNotice("Payment confirmed. Your account has been updated.");
      refreshOrder(); void refresh();
      try { localStorage.removeItem("framelyn.pending-order"); } catch { /* Payment confirmation does not depend on browser storage. */ }
      return true;
    }
    refreshOrder();
    setNotice(automatic ? "Waiting for payment confirmation. This can take a moment." : "Payment has not been confirmed yet. If you have paid, check again shortly; do not pay a second time.");
    return false;
  }, [id, user, sessionVersion, refreshOrder, refresh]);

  // The return URL is only a cue to ask the server. It never marks an order paid.
  const checkLatest = useRef(verify);
  useEffect(() => { checkLatest.current = verify; }, [verify]);
  useEffect(() => {
    if (!["success", "returned"].includes(returned) || !user?.id || !id) return;
    let active = true; let attempts = 0; let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const paid = await checkLatest.current(true);
      if (active && !paid && ++attempts < 5) timer = setTimeout(() => void check(), 3000);
    };
    timer = setTimeout(() => void check(), 0);
    return () => { active = false; clearTimeout(timer); operation.current?.abort(); };
  }, [returned, user?.id, id]);

  const resume = async () => {
    if (!id || !user || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const version = sessionVersion(); const timeout = setTimeout(() => controller.abort(), 30_000);
    setBusy(true); setError("");
    const result = await orderApi.resume(id, controller.signal);
    clearTimeout(timeout);
    if (operation.current !== controller) return;
    operation.current = null; setBusy(false);
    if (sessionVersion() !== version) { setError("Your sign-in was updated. Prepare this checkout again."); return; }
    if (controller.signal.aborted) { setError("Checkout preparation was interrupted. Retry this order instead of creating another."); return; }
    if (!result.success) { refreshOrder(); setError(result.message); return; }
    if (result.data?.id !== id) { setError("The checkout response was incomplete. Retry this order."); return; }
    refreshOrder();
    if (result.data.status === 1) { setConfirmed(true); setNotice("Payment confirmed. Your account has been updated."); void refresh(); return; }
    setNotice(result.data.payUrl ? "Checkout is ready. Open the secure payment page below." : "This checkout is no longer open. Check your payment status before placing another order.");
  };

  const status = order.data?.status === 3 ? 3 : confirmed ? 1 : order.data?.status || 0;
  const processing = status === 0 && order.data?.paymentProcessing === true;
  const state = processing ? "Payment processing" : ["Awaiting payment", "Paid", "Cancelled", "Refunded"][status] || "Unknown";
  const pancake = order.data?.payMethod === "pancake";
  const stripe = order.data?.payMethod === "stripe" || pancake;
  const providerName = pancake ? "Waffo Pancake" : "Stripe";
  const checkoutAvailable = !processing && order.data?.checkoutAvailable !== false;
  const payUrl = order.data && checkoutAvailable ? checkoutUrl(order.data) : "";
  return <WorkspaceShell>
    <PageHeading title="Your checkout." description="Review the order and follow your payment status." action={<Link className="button small" href="/account?tab=orders">Order history <ArrowUpRight size={14} /></Link>} />
    <RequireAccount>{!id ? <EmptyState title="Choose a plan to begin." description="Your order will appear here when you choose a plan." action={<Link className="button primary" href="/pricing">Explore plans <ArrowUpRight size={14} /></Link>} />
      : order.loading ? <Loading label="Opening your order…" />
      : order.error ? <Alert>{order.error}<button className="text-link" onClick={order.refresh}>Try again</button></Alert>
      : order.data && <section className="panel billing-invoice">
        <div className="invoice-heading"><CreditCard size={25} /><span className={`tag ${status === 1 ? "good" : ""}`}>{state}</span></div>
        <p className="small muted">{pancake && !order.data.chargedTotal ? "Subtotal before tax" : status === 1 ? "Amount paid" : status === 3 ? "Original amount paid" : "Order total"}</p>
        <h2 className="invoice-total">{money(order.data.chargedTotal || order.data.amount, order.data.currency || "CNY")}</h2>
        <div className="invoice-rows">
          {order.data.planName && <div><span>Plan</span><strong>{order.data.planName}</strong></div>}
          <div><span>Order number</span><strong className="mono">{order.data.orderNo}</strong></div>
          <div><span>Created</span><strong>{date(order.data.createTime)}</strong></div>
          <div><span>Purchase</span><strong>{stripe ? (order.data.cycle === "yearly" ? "Large credit pack (12×)" : "Standard credit pack") : (order.data.cycle === "yearly" ? "Annual purchase" : "Monthly purchase")}</strong></div>
          {stripe && <div><span>Payment</span><strong>{providerName} · One-time</strong></div>}
          {order.data.credits !== undefined && <div><span>Credits included</span><strong>{number(order.data.credits)}</strong></div>}
          {order.data.expireTime && status === 0 && <div><span>Complete checkout before</span><strong>{date(order.data.expireTime)}</strong></div>}
          {order.data.prepareBefore && status === 0 && <div><span>Prepare checkout before</span><strong>{date(order.data.prepareBefore)}</strong></div>}
          {order.data.payTime && <div><span>Paid</span><strong>{date(order.data.payTime)}</strong></div>}
        </div>
        {pancake && status === 0 && <p className="panel-description">The pack price excludes applicable taxes. Checkout shows the final total before payment.</p>}
        {pancake && !!order.data.chargedTotal && <div className="invoice-rows"><div><span>Subtotal</span><strong>{money(order.data.amount, "USD")}</strong></div><div><span>Tax</span><strong>{money(order.data.taxTotal || 0, "USD")}</strong></div><div><span>Total paid</span><strong>{money(order.data.chargedTotal, "USD")}</strong></div>{!!order.data.refundedTotal && <div><span>Payment refunded</span><strong>{money(order.data.refundedTotal, "USD")}</strong></div>}</div>}
        {pancake && status === 0 && order.data.cancelAvailable === false && <p className="panel-description">An issued payment link may still accept payment. If checkout has expired or cannot be resumed, contact support with this order number before buying again.</p>}
        {stripe && <p className="panel-description">One payment. No automatic renewal. {status === 0 && "Your included credits are added together once payment is confirmed."}</p>}
        {review && status === 0 && <p className="panel-description" role="status">The order details changed after your selection. Review the confirmed price, credits and purchase option before opening checkout.</p>}{existing && status === 0 && !processing && <p className="panel-description" role="status">You already have an unfinished purchase for this plan. Review its original amount and purchase option here. {order.data.cancelAvailable !== false && <>You can cancel it in <Link className="text-link" href="/account?tab=orders">Order history</Link> before choosing another option.</>}</p>}
        {processing && <p className="panel-description" role="status">{pancake ? "Waffo Pancake has not confirmed payment yet." : "Stripe is still processing your payment."} Your credits will be added when it succeeds. Please do not pay again.</p>}
        {stripe && status === 0 && !processing && !checkoutAvailable && <p className="panel-description">New payments are temporarily unavailable. If you have already paid, you can still check your payment status.</p>}
        {returned === "cancelled" && status === 0 && !notice && <p className="panel-description">You returned without completing checkout. You can continue with this order when you are ready.</p>}
        {error && <Alert>{error}</Alert>}
        {notice && !processing && status <= 1 && (status === 1 ? <Alert success>{notice}</Alert> : <p className="panel-description" role="status">{notice}</p>)}
        <div className="invoice-actions">
          {status === 0 && payUrl && <a className="button primary" href={payUrl} target="_blank" rel="noopener noreferrer">Open secure checkout <ArrowUpRight size={15} /></a>}
          {status === 0 && stripe && checkoutAvailable && !payUrl && <button className="button primary" disabled={busy} onClick={() => void resume()}>Prepare checkout <ArrowUpRight size={15} /></button>}
          {(status === 0 || (stripe && status === 2)) && <button className="button" disabled={busy} onClick={() => void verify()}><RefreshCw size={14} />{busy ? "Checking…" : "Check payment status"}</button>}
          {status === 1 && <Link className="button primary" href="/studio"><Check size={16} />Back to creating</Link>}
          {status === 2 && <Link className="button" href="/pricing">Explore plans <ArrowUpRight size={15} /></Link>}
        </div>
        {status === 0 && !processing && <p className="panel-description" style={{ marginTop: 24, marginBottom: 0 }}>Checkout opens in a separate tab. Return here to verify your payment and updated balance.</p>}
        <p className="panel-description">Need a receipt, a payment refund, or help with this order? <SupportLink reference={`Order ${order.data.orderNo}`} /></p>
      </section>}
    </RequireAccount>
  </WorkspaceShell>;
}
