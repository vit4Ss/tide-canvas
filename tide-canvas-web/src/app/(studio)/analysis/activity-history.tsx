"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, History, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { socialAnalysisApi } from "@/lib/social-analysis-api";
import type { SocialActivityRecordDetailVO } from "@/lib/social-analysis-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import type { SocialActivityRecordVO, SocialActivityType } from "@/types/social-record";
import styles from "./analysis.module.css";

const PAGE_SIZE = 12;

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
  youtube: "YouTube",
  tiktok: "TikTok",
  kuaishou: "快手",
  pinterest: "Pinterest",
  instagram: "Instagram",
};

const QUALITY_LABEL: Record<string, string> = { compat: "兼容", quality: "高清", speed: "极速" };

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value || "—";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("zh-CN", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function statusLabel(status: SocialActivityRecordVO["status"]): string {
  switch (status) {
    case "succeeded": return "成功";
    case "failed": return "失败";
    case "expired": return "已过期";
    case "ready": return "待下载";
    case "downloading": return "下载中";
    default: return "处理中";
  }
}

function recordLabel(row: SocialActivityRecordVO): string {
  if (row.type === "download") return row.quality ? `${QUALITY_LABEL[row.quality] || row.quality}画质` : "视频下载";
  return row.kind === "account" ? "账号分析" : "作品分析";
}

interface ActivityHistorySidebarProps {
  selectedId?: string;
  watchId?: string;
  refreshKey: number;
  onSelect: (record: SocialActivityRecordDetailVO) => void | Promise<void>;
}

export function ActivityHistorySidebar({ selectedId, watchId, refreshKey, onSelect }: ActivityHistorySidebarProps) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const requestRef = useRef(0);
  const [type, setType] = useState<"" | SocialActivityType>("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SocialActivityRecordVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  const load = useCallback(async () => {
    const requestID = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      if (!await ensureSession()) return;
      const response = await socialAnalysisApi.records({ pageNum: page, pageSize: PAGE_SIZE, ...(type ? { type } : {}) });
      if (requestID !== requestRef.current) return;
      if (!response.success || !response.data) {
        setError(response.message || "记录加载失败，请稍后重试");
        return;
      }
      setRows(response.data.records);
      setTotal(response.data.total);
    } catch {
      if (requestID === requestRef.current) setError("记录加载失败，请稍后重试");
    } finally {
      if (requestID === requestRef.current) setLoading(false);
    }
  }, [ensureSession, page, type]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    if (!watchId || page !== 1 || type === "analysis") return;
    const watched = rows.find((row) => row.id === watchId);
    if (watched && (watched.status === "succeeded" || watched.status === "failed" || watched.status === "expired")) return;
    const timer = window.setTimeout(() => { void load(); }, 5_000);
    return () => window.clearTimeout(timer);
  }, [load, page, rows, type, watchId]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openRecord = async (record: SocialActivityRecordVO) => {
    if (openingId) return;
    setOpeningId(record.id);
    try {
      if (!await ensureSession()) return;
      const response = await socialAnalysisApi.record(record.id);
      if (!response.success || !response.data) {
        toast.error(response.message || "记录详情加载失败");
        return;
      }
      await onSelect(response.data);
    } catch {
      toast.error("记录详情加载失败，请稍后重试");
    } finally {
      setOpeningId("");
    }
  };

  return (
    <aside className={styles.historySidebar} aria-busy={loading} aria-label="我的使用记录">
      <header className={styles.historyHeader}>
        <div>
          <small>HISTORY</small>
          <h2>使用记录</h2>
          <p>仅当前账号可见</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="刷新使用记录">
          {loading ? <Loader2 className={styles.spin} aria-hidden /> : <RefreshCw aria-hidden />}
          刷新
        </button>
      </header>

      <div className={styles.historyFilters} role="group" aria-label="记录类型">
        {([
          ["", "全部"],
          ["analysis", "内容分析"],
          ["download", "视频下载"],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            key={value || "all"}
            aria-pressed={type === value}
            className={type === value ? styles.historyFilterActive : ""}
            onClick={() => { setType(value); setPage(1); }}
          >{label}</button>
        ))}
        <span>{total.toLocaleString("zh-CN")} 条记录</span>
      </div>

      {loading ? (
        <div className={styles.historyLoading} role="status" aria-label="正在加载使用记录">
          {[0, 1, 2, 3].map((item) => <i key={item} />)}
        </div>
      ) : error ? (
        <div className={styles.historyEmpty} role="alert">
          <strong>记录暂时无法加载</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>重新加载</button>
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.historyEmpty}>
          <History aria-hidden />
          <strong>还没有使用记录</strong>
          <p>完成一次内容分析，或解析并下载公开视频后，记录会出现在这里。</p>
        </div>
      ) : (
        <div className={styles.historyList}>
          {rows.map((row) => (
            <article className={styles.historyRow} data-selected={selectedId === row.id ? "true" : "false"} key={row.id}>
              <button type="button" className={styles.historyRecordButton} aria-pressed={selectedId === row.id} onClick={() => void openRecord(row)} disabled={!!openingId}>
                <span className={styles.historyTypeIcon} data-type={row.type}>
                  {openingId === row.id ? <Loader2 className={styles.spin} aria-hidden /> : row.type === "download" ? <Download aria-hidden /> : <ScanSearch aria-hidden />}
                </span>
                <span className={styles.historyCopy}>
                  <strong title={row.title || row.sourceUrl}>{row.title || (row.type === "download" ? "公开视频" : "内容分析")}</strong>
                  <span>
                    {PLATFORM_LABEL[row.platform || ""] || row.platform || "待识别"}<i aria-hidden>·</i>{recordLabel(row)}
                    {row.type === "download" && (row.downloadedBytes || row.estimatedBytes) ? <><i aria-hidden>·</i>{formatBytes(row.downloadedBytes || row.estimatedBytes)}</> : null}
                  </span>
                  {row.errorMessage ? <em title={row.errorMessage}>{row.errorMessage}</em> : null}
                </span>
                <span className={styles.historyState} data-status={row.status}><i aria-hidden />{statusLabel(row.status)}</span>
                <time dateTime={row.createTime}>{formatTime(row.createTime)}</time>
              </button>
              <a href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开来源链接"><ExternalLink aria-hidden /></a>
            </article>
          ))}
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE ? (
        <footer className={styles.historyPager}>
          <span>第 {page} / {pageCount} 页</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}
