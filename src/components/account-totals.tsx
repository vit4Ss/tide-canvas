"use client";
import { useResource } from "@/lib/use-resource";
import { Alert, Loading } from "./ui";

interface Totals { opening: number; added: number; deducted: number; refunded: number; total: number; reserved: number; available: number }
const number = (value: string | number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value));
export function AccountTotals({ owner }: { owner: string }) {
  const data = useResource<Totals>("/api/points/summary", !!owner, owner);
  const valid = data.data && Object.values(data.data).length >= 7 && Object.values(data.data).every(Number.isFinite);
  return <details className="account-totals"><summary>Reconcile your account balance</summary>
    <p>Your balance is shared across every service linked to this account. The media list below covers this site’s supported formats only. Account totals include purchases, refunds, adjustments and other activity without displaying text-generation records.</p>
    {data.loading && <Loading label="Reading account totals…" />}
    {data.error && <Alert>{data.error}<button className="text-link" onClick={data.refresh}>Try again</button></Alert>}
    {valid && data.data && <><dl className="totals-grid">{[["Balance before recorded transactions",data.data.opening],["Credits added (including refunds)",data.data.added],["Credits deducted",data.data.deducted],["Total balance",data.data.total],["Reserved for active requests",data.data.reserved],["Available to spend",data.data.available]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl><p className="small muted">Opening balance + credits added − credits deducted = total balance. Total − reserved = available. Refunds included in additions: {number(data.data.refunded)} credits.</p></>}
    {!data.loading && !data.error && !valid && <p>Account totals are not available from this service yet.</p>}
    <button className="button small" disabled={data.loading} onClick={data.refresh}>Refresh account totals</button>
  </details>;
}
