"use client";
import Link from "next/link";
import { Select } from "./select";
import { useState } from "react";
import { Search, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, Modal, PageHeading, RequireAccount } from "./ui";
import { useMediaHistory } from "@/lib/use-media-history";
import { useResource } from "@/lib/use-resource";
import { date, number } from "@/lib/brand";
import { englishError } from "@/lib/english";
import type { UserGenerationHistoryVO, UserGenerationHistoryDetailVO } from "@/types/ai";
import styles from "./activity.module.css";

const paramLabels: Record<string, string> = { resolution: "Resolution", targetResolution: "Target resolution", target_resolution: "Target resolution", outputFps: "Frame rate", output_fps: "Frame rate", upscaleModel: "Enhancement", upscale_model: "Enhancement", aspectRatio: "Aspect ratio", ratio: "Aspect ratio", duration: "Duration", quality: "Quality", count: "Count" };
const creationName = (name: string) => name && !/[\p{Script=Han}]/u.test(name) ? name : "AI creation";
const formatName = (format: string) => format === "3d" ? "3D" : format === "upscale" ? "Enhance" : format.charAt(0).toUpperCase() + format.slice(1);

function Credits({ row }: { row: UserGenerationHistoryVO }) {
  return <>{row.pointCost === undefined ? "—" : number(row.pointCost)}{row.refundedPoints ? <p className="small muted">{number(row.refundedPoints)} refunded</p> : null}</>;
}

function ActivityDetail({ detail }: { detail: UserGenerationHistoryDetailVO }) {
  return <div className="activity-detail">
    <dl><div><dt>Model</dt><dd>{creationName(detail.model)}</dd></div><div><dt>Created</dt><dd>{date(detail.createTime)}</dd></div><div><dt>Credits</dt><dd>{number(detail.pointCost || 0)}</dd></div><div><dt>Duration</dt><dd>{number(detail.durationMs / 1000)} seconds</dd></div></dl>
    {detail.failureReason && <Alert>{englishError(detail.failureReason)}</Alert>}
    {detail.prompt && <blockquote>{detail.prompt}</blockquote>}
    <div className="detail-assets">{(detail.resultAssets || []).map((asset) => <a key={asset.url} href={asset.url} target="_blank" rel="noreferrer">{asset.kind === "image" ? <img src={asset.url} alt="Creation result" loading="lazy" /> : <span className="button">Open {asset.kind} <ArrowUpRight size={14} /></span>}</a>)}</div>
    {detail.resultText && <blockquote>{detail.resultText}</blockquote>}
    <dl>{(detail.parameters || []).map((parameter) => <div key={parameter.key}><dt>{paramLabels[parameter.key] || parameter.key}</dt><dd>{parameter.value}</dd></div>)}</dl>
  </div>;
}

export default function Activity() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [media, setMedia] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const url = `/api/ai/history?pageNum=${page}&pageSize=20${media ? `&mediaType=${media}` : ""}${success ? `&success=${success}` : ""}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`;
  const resource = useMediaHistory<UserGenerationHistoryVO>(url, !!user, user?.id);
  // Closing or replacing the selected record cancels and isolates its request.
  const detail = useResource<UserGenerationHistoryDetailVO>(`/api/ai/history/${encodeURIComponent(detailId || "")}`, !!detailId && !!user, user?.id);
  const filtering = Boolean(media || success || keyword);
  const resetFilters = () => { setMedia(""); setSuccess(""); setQuery(""); setKeyword(""); setPage(1); };

  return <WorkspaceShell>
    <PageHeading title="Your creative trail." description="Generation history, results and the credits behind them." action={<button className="button small" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={13} />Refresh</button>} />
    <RequireAccount>
      <div className={`toolbar ${styles.toolbar}`}>
        <form className={`search-field ${styles.search}`} onSubmit={(event) => { event.preventDefault(); setKeyword(query.trim()); setPage(1); }}>
          <Search size={16} aria-hidden="true" /><input aria-label="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts…" />
          {(query || keyword) && <button type="button" className="icon-button" aria-label="Clear activity search" onClick={() => { setQuery(""); setKeyword(""); setPage(1); }}><X size={15} /></button>}
          <button className="button small" type="submit">Search</button>
        </form>
        <div className={`field-row ${styles.filters}`}>
          <Select aria-label="Filter activity by format" value={media} onValueChange={(value) => { setMedia(value); setPage(1); }} options={[{ value: "", label: "All formats" }, ...["image", "video", "audio", "3d"].map((value) => ({ value, label: formatName(value) }))]} />
          <Select aria-label="Filter activity by status" value={success} onValueChange={(value) => { setSuccess(value); setPage(1); }} options={[{ value: "", label: "All outcomes" }, { value: "1", label: "Completed" }, { value: "0", label: "Failed" }]} />
        </div>
      </div>
      {filtering && <div className={styles.filterSummary}><span>Showing filtered activity</span><button className="button small" onClick={resetFilters}>Reset filters <X size={13} /></button></div>}
      {resource.loading && <Loading label="Reading your activity…" />}
      {resource.error && <Alert>{resource.error}<button className="text-link" onClick={resource.refresh}>Try again</button></Alert>}
      {!resource.loading && resource.data?.records.length === 0 && <EmptyState title={filtering ? "No matching creations." : "The story starts with your first idea."} description={filtering ? "Try another prompt or clear your filters to see all activity." : "Your completed generation history will be recorded here."} action={filtering ? undefined : <Link className="button primary" href="/studio">Start creating <ArrowUpRight size={15} /></Link>} />}
      {!!resource.data?.records.length && <>
        <div className={`table-wrap ${styles.desktop}`}><table><thead><tr><th>Creation</th><th>Format</th><th>Source</th><th>Outcome</th><th>Credits</th><th>Created</th><th aria-label="Details" /></tr></thead>
          <tbody>{resource.data.records.map((row) => <tr key={row.id}>
            <td className="wrap-cell"><strong>{creationName(row.model)}</strong><p className={styles.prompt}>{row.prompt?.slice(0, 85) || "Media task"}</p></td><td>{formatName(row.mediaType)}</td>
            <td><span className="tag">{row.isApiCall ? "API" : "Studio"}</span></td><td><span className={`tag ${row.success ? "good" : ""}`}>{row.success ? "Completed" : "Failed"}</span></td>
            <td><Credits row={row} /></td><td>{date(row.createTime)}</td><td><button className="icon-button" aria-label="View activity details" onClick={() => setDetailId(row.id)}><ArrowUpRight size={16} /></button></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobile}>{resource.data.records.map((row) => <article className={styles.card} key={row.id}>
          <header><span className="tag">{formatName(row.mediaType)} · {row.isApiCall ? "API" : "Studio"}</span><span className={`tag ${row.success ? "good" : ""}`}>{row.success ? "Completed" : "Failed"}</span></header>
          <h2>{creationName(row.model)}</h2><p className={styles.prompt}>{row.prompt || "Media task"}</p>
          <dl><div><dt>Credits</dt><dd><Credits row={row} /></dd></div><div><dt>Created</dt><dd>{date(row.createTime)}</dd></div></dl>
          <button className="button small" aria-label="View activity details" onClick={() => setDetailId(row.id)}>View details <ArrowUpRight size={15} /></button>
        </article>)}</div>
      </>}
      {resource.data && resource.data.total > 20 && <div className="pagination"><span>{number(resource.data.total)} records · Page {page}</span><div><button className="button small" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button small" disabled={page * 20 >= resource.data.total} onClick={() => setPage(page + 1)}>Next</button></div></div>}
    </RequireAccount>
    {detailId && <Modal title="Creation details" onClose={() => setDetailId(null)}>
      {detail.loading && <Loading label="Opening creation details…" />}
      {detail.error && <Alert>{detail.error}<button className="button small" onClick={detail.refresh}>Try again</button></Alert>}
      {detail.data && <ActivityDetail detail={detail.data} />}
    </Modal>}
  </WorkspaceShell>;
}
