"use client";
import { useBrand } from "./runtime-config";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, RefreshCw, Check, CreditCard } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, PageHeading, RequireAccount } from "./ui";
import { useResource } from "@/lib/use-resource";
import { orderApi } from "@/lib/api";
import { date } from "@/lib/brand";
import type { OrderVO } from "@/types/billing";

export default function Billing() {
  const { money } = useBrand();
  const query = useSearchParams(); const { user, refresh } = useAuth(); const id = query.get("order") || ""; const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const order = useResource<OrderVO>(`/api/orders/${encodeURIComponent(id)}`, !!user && !!id, user?.id);
  const verify = async () => { setBusy(true); setError(""); const result = await orderApi.verify(id); if (result.success) { setNotice(result.data.paid ? "Payment confirmed. Your account has been updated." : "Payment has not been confirmed yet. Please check again after completing checkout."); order.refresh(); void refresh(); if (result.data.paid) localStorage.removeItem("framelyn.pending-order"); } else setError(result.message); setBusy(false); };
  const state = ["Awaiting payment", "Paid", "Cancelled", "Refunded"][order.data?.status || 0]; const payUrl = order.data?.payUrl && /^https?:\/\//.test(order.data.payUrl) ? order.data.payUrl : "";
  return <WorkspaceShell><PageHeading title="Your checkout." description="Review the order and follow your payment status." action={<Link className="button small" href="/account?tab=orders">Order history <ArrowUpRight size={14} /></Link>} /><RequireAccount>{!id ? <EmptyState title="Choose a plan to begin." description="Your order will appear here when you choose a plan." action={<Link className="button primary" href="/pricing">Explore plans <ArrowUpRight size={14} /></Link>} /> : order.loading ? <Loading label="Opening your order…" /> : order.error ? <Alert>{order.error}</Alert> : order.data && <section className="panel billing-invoice"><div className="invoice-heading"><CreditCard size={25} /><span className={`tag ${order.data.status === 1 ? "good" : ""}`}>{state}</span></div><p className="small muted">{order.data.status === 1 ? "Amount paid" : "Order total"}</p><h2 className="invoice-total">{money(order.data.amount, order.data.currency || "CNY")}</h2><div className="invoice-rows"><div><span>Order number</span><strong className="mono">{order.data.orderNo}</strong></div><div><span>Created</span><strong>{date(order.data.createTime)}</strong></div><div><span>Purchase</span><strong>{order.data.cycle === "yearly" ? "Annual plan" : "Monthly plan"}</strong></div>{order.data.expireTime && order.data.status === 0 && <div><span>Complete checkout before</span><strong>{date(order.data.expireTime)}</strong></div>}{order.data.payTime && <div><span>Paid</span><strong>{date(order.data.payTime)}</strong></div>}</div>{error && <Alert>{error}</Alert>}{notice && <Alert success>{notice}</Alert>}<div className="invoice-actions">{order.data.status === 0 && payUrl && <a className="button primary" href={payUrl} target="_blank" rel="noopener noreferrer">Open secure checkout <ArrowUpRight size={15} /></a>}{order.data.status === 0 && <button className="button" disabled={busy} onClick={() => void verify()}><RefreshCw size={14} />{busy ? "Checking…" : "I have completed payment"}</button>}{order.data.status === 1 && <Link className="button primary" href="/studio"><Check size={16} />Back to creating</Link>}</div><p className="panel-description" style={{ marginTop: 24, marginBottom: 0 }}>Checkout opens in a separate tab. Return here to verify your payment and updated balance.</p></section>}</RequireAccount></WorkspaceShell>;
}
