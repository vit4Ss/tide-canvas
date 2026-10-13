"use client";
import Link from "next/link";
import { AccountTotals } from "./account-totals";
import { useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, PageHeading, RequireAccount } from "./ui";
import { useResource } from "@/lib/use-resource";
import { useMediaHistory } from "@/lib/use-media-history";
import { date, number } from "@/lib/brand";
import type { UserGenerationHistoryVO } from "@/types/ai";

export default function Usage() {
  const { user, refresh: refreshUser } = useAuth();
  const [page, setPage] = useState(1);
  const balance = useResource<{ points: number; frozen: number }>("/api/points/balance", !!user, user?.id);
  const usage = useMediaHistory<UserGenerationHistoryVO>(`/api/ai/history?pageNum=${page}&pageSize=20`, !!user, user?.id);
  return <WorkspaceShell>
    <PageHeading title="A clear view of your credits." description="Follow the credits used for your images, video, audio and 3D creations." action={<Link className="button small" href="/pricing">Find your plan <ArrowUpRight size={14} /></Link>} />
    <RequireAccount>
      <div className="stats-strip">
        <div><span>Available credits</span><strong>{balance.data ? number(balance.data.points) : "—"}</strong><small>Ready for your next idea</small></div>
        <div><span>Reserved credits</span><strong>{balance.data ? number(balance.data.frozen) : "—"}</strong><small>Held for requests in progress</small></div>
        <div><span>Your account</span><strong>One balance</strong><small>Shared across all account activity</small></div>
      </div>
      <AccountTotals owner={user?.id || ""} />
      <div className="toolbar">
        <h2>Media activity</h2>
        <button className="button small" onClick={() => { usage.refresh(); balance.refresh(); void refreshUser(); }}><RefreshCw size={13} />Refresh</button>
      </div>
      {balance.error && <Alert>{balance.error}</Alert>}
      {usage.error && <Alert>{usage.error}</Alert>}
      {usage.loading && <Loading label="Reading your usage…" />}
      {usage.data?.records.length === 0 && <EmptyState title="A clean slate." description="Your media generation charges and refunds will appear here." />}
      {!!usage.data?.records.length && <div className="table-wrap"><table>
        <thead><tr><th>Creation</th><th>Format</th><th>Charged credits</th><th>Refunded credits</th><th>Date</th></tr></thead>
        <tbody>{usage.data.records.map((row) => <tr key={row.id}>
          <td>{row.model && !/[\p{Script=Han}]/u.test(row.model) ? row.model : "Media creation"}</td>
          <td>{row.mediaType === "3d" ? "3D" : row.mediaType}</td>
          <td>{row.pointCost === undefined ? "—" : number(row.pointCost)}</td>
          <td>{row.refundedPoints === undefined ? "—" : number(row.refundedPoints)}</td>
          <td>{date(row.createTime)}</td>
        </tr>)}</tbody>
      </table></div>}
      {usage.data && usage.data.total > 20 && <div className="pagination">
        <span>Page {page} · {number(usage.data.total)} records</span>
        <div><button className="button small" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button small" disabled={page * 20 >= usage.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
      </div>}
      <p className="small muted" style={{ marginTop: 24 }}>See task details in <Link href="/history" className="text-link">Activity <ArrowUpRight size={12} /></Link>, or review purchases in <Link href="/billing" className="text-link">Billing <ArrowUpRight size={12} /></Link>.</p>
    </RequireAccount>
  </WorkspaceShell>;
}
