"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, History, Loader2, RefreshCw } from "lucide-react";
import { socialAnalysisApi } from "@/lib/social-analysis-api";
import type { SocialActivityRecordDetailVO } from "@/lib/social-analysis-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import type { SocialActivityRecordVO, SocialActivityType } from "@/types/social-record";
import { reconcileHistoryRows, startDownloadHistoryPolling } from "./activity-history-polling";
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

const QUALITY_LABEL: Record<string, string> = { compat: "兼容", quality: "最高", speed: "极速" };

const PLATFORM_MARK: Record<string, string> = {
  douyin: "抖", bilibili: "B", xiaohongshu: "小", youtube: "▶",
  tiktok: "♪", kuaishou: "快", pinterest: "P", instagram: "IG",
};

function RecordAvatar({ row }: { row: SocialActivityRecordVO }) {
  const [failedUrl, setFailedUrl] = useState("");
  const avatarUrl = row.avatarUrl?.trim() || "";
  const showAvatar = /^https?:\/\//i.test(avatarUrl) && avatarUrl !== failedUrl;
  return (
    <span className={styles.historyPlatformMark} data-avatar={showAvatar ? "true" : undefined} aria-hidden>
      {showAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl)} />
      ) : PLATFORM_MARK[row.platform || ""] || "↗"}
    </span>
  );
}

function formatTime(value: string, full = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return full ? value || "时间未知" : "—";
  return date.toLocaleString("zh-CN", {
    ...(full ? { year: "numeric", month: "2-digit", day: "2-digit", second: "2-digit" } as const : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dateGroup(value: string): { key: string; label: string } {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { key: "unknown", label: "日期未知" };
  // Use calendar dates in the reader's timezone, including across year boundaries.
  const year = date.getFullYear();
  return {
    key: `${year}-${date.getMonth() + 1}-${date.getDate()}`,
    label: `${year === new Date().getFullYear() ? "" : `${year} 年 `}${date.getMonth() + 1} 月 ${date.getDate()} 日`,
  };
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
  onBillingChange?: () => void;
  onSelect: (record: SocialActivityRecordDetailVO) => void | Promise<void>;
}

export function ActivityHistorySidebar({ selectedId, watchId, refreshKey, onSelect, onBillingChange }: ActivityHistorySidebarProps) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const refreshBalance = useAuthStore((state) => state.fetchUser);
  const billingStateRef = useRef("");
  const requestRef = useRef(0);
  const pendingRef = useRef(0);
  const loadedViewRef = useRef("");
  const openingRef = useRef<string | null>(null);
  const [type, setType] = useState<"" | SocialActivityType>("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SocialActivityRecordVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  useEffect(() => () => { openingRef.current = null; }, []);

  const load = useCallback(async (silent = false): Promise<SocialActivityRecordVO[] | null | undefined> => {
    const requestID = ++requestRef.current;
    pendingRef.current = requestID;
    const view = `${type}:${page}`;
    const initialLoad = loadedViewRef.current !== view;
    // Only a first load or a different filter/page replaces the list with a
    // skeleton. Polling and new activity must preserve its DOM and scroll.
    if (initialLoad) setLoading(true);
    else if (!silent) setRefreshing(true);
    if (!silent || initialLoad) setError("");
    try {
      if (!await ensureSession()) return null;
      if (requestID !== requestRef.current) return;
      const response = await socialAnalysisApi.records({ pageNum: page, pageSize: PAGE_SIZE, ...(type ? { type } : {}) });
      if (requestID !== requestRef.current) return;
      if (!response.success || !response.data) {
        if (!silent || initialLoad) setError(response.message || "记录加载失败，请稍后重试");
        return null;
      }
      const records = response.data.records;
      // A cancelled transfer can refund just after its HTTP callback refreshed
      // the balance. Refresh once when history confirms the billing change,
      // without refreshing the account on every download-status poll.
      const billingState = records.map(row => `${row.id}:${row.pointCost}:${row.refunded}`).join("|");
      if (billingStateRef.current !== billingState) {
        billingStateRef.current = billingState;
        void refreshBalance(true);
        onBillingChange?.();
      }
      loadedViewRef.current = view;
      setRows((current) => reconcileHistoryRows(current, records));
      setTotal(response.data.total);
      setError("");
      return records;
    } catch {
      if (requestID !== requestRef.current) return;
      if (!silent || initialLoad) setError("记录加载失败，请稍后重试");
      return null;
    } finally {
      if (pendingRef.current === requestID) pendingRef.current = 0;
      if (requestID === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [ensureSession, refreshBalance, page, type, onBillingChange]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(true));
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    if (!watchId || page !== 1 || type === "analysis") return;
    return startDownloadHistoryPolling(watchId, () => load(true), () => document.hidden || pendingRef.current !== 0);
  }, [load, page, type, watchId, refreshKey, pollAttempt]);

  const refresh = () => {
    void load();
    setPollAttempt((value) => value + 1);
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openRecord = async (record: SocialActivityRecordVO) => {
    if (openingRef.current) return;
    openingRef.current = record.id;
    setOpeningId(record.id);
    try {
      if (!await ensureSession() || openingRef.current !== record.id) return;
      const response = await socialAnalysisApi.record(record.id);
      if (openingRef.current !== record.id) return;
      if (!response.success || !response.data) {
        toast.error(response.message || "记录详情加载失败");
        return;
      }
      await onSelect(response.data);
    } catch {
      if (openingRef.current === record.id) toast.error("记录详情加载失败，请稍后重试");
    } finally {
      if (openingRef.current === record.id) {
        openingRef.current = null;
        setOpeningId("");
      }
    }
  };

  return (
    <aside className={styles.historySidebar} aria-busy={loading} aria-label="我的使用记录">
      <header className={styles.historyHeader}>
        <div className={styles.historyHeading}>
          <span className={styles.historyHeadingIcon}><History aria-hidden /></span>
          <div>
            <h2>历史记录</h2>
            <p>回看分析 · 追踪下载</p>
          </div>
        </div>
        <button type="button" onClick={refresh} disabled={loading || refreshing} aria-label="刷新使用记录" title="刷新使用记录">
          {loading || refreshing ? <Loader2 className={styles.spin} aria-hidden /> : <RefreshCw aria-hidden />}
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
      </div>

      <div className={styles.historySummary}>
        <span>仅当前账号可见</span>
        <span>{loading ? "加载中…" : error ? "加载失败" : `共 ${total.toLocaleString("zh-CN")} 条`}</span>
      </div>

      {loading ? (
        <div className={styles.historyLoading} role="status" aria-label="正在加载使用记录">
          {[0, 1, 2, 3].map((item) => <i key={item} aria-hidden />)}
        </div>
      ) : error ? (
        <div className={styles.historyEmpty} role="alert">
          <strong>记录暂时无法加载</strong>
          <p>{error}</p>
          <button type="button" onClick={refresh}>重新加载</button>
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.historyEmpty}>
          <History aria-hidden />
          <strong>还没有使用记录</strong>
          <p>完成内容分析或开始下载视频后，记录会出现在这里。仅解析、切换画质不会新增下载记录。</p>
        </div>
      ) : (
        <div className={styles.historyList}>
          {rows.map((row, index) => {
            const group = dateGroup(row.createTime);
            const startsGroup = index === 0 || group.key !== dateGroup(rows[index - 1].createTime).key;
            const selected = selectedId === row.id;
            const label = recordLabel(row);
            return (
              <div className={styles.historyEntry} key={row.id}>
                {startsGroup ? <div className={styles.historyDate}><span>{group.label}</span><i aria-hidden /></div> : null}
                <article className={styles.historyRow} data-selected={selected ? "true" : "false"} data-status={row.status}>
                  <button type="button" className={styles.historyRecordButton} aria-pressed={selected} onClick={() => void openRecord(row)} disabled={!!openingId}>
                    <span className={styles.historyRecordMeta}>
                      <span>{row.type === "download" && row.quality ? `视频下载 · ${label}` : label}</span>
                      <time dateTime={row.createTime} title={`当时调用：${formatTime(row.createTime, true)}`}>{formatTime(row.createTime)}</time>
                    </span>
                    <span className={styles.historyCopy}>
                      <RecordAvatar row={row} />
                      <span className={styles.historyIdentity}>
                        <strong title={row.title || row.sourceUrl}>{row.title || (row.type === "download" ? "公开视频" : label)}</strong>
                        <span className={styles.historyPlatform}>
                          {PLATFORM_LABEL[row.platform || ""] || row.platform || "待识别"}
                          {row.type === "download" && (row.downloadedBytes || row.estimatedBytes) ? <><i aria-hidden> / </i>{formatBytes(row.downloadedBytes || row.estimatedBytes)}</> : null}
                        </span>
                      </span>
                    </span>
                    {row.errorMessage ? <span className={styles.historyError} title={row.errorMessage}>{row.errorMessage}</span> : null}
                    <span className={styles.historyRecordFoot}>
                      <span className={styles.historyState} data-status={row.status}>
                        {openingId === row.id ? <><Loader2 className={styles.spin} aria-hidden />打开中</>
                          : row.status === "succeeded" ? <><Check aria-hidden />已完成</>
                          : statusLabel(row.status)}
                      </span>
                      {!!row.pointCost && <span title={row.refunded ? "本次执行积分已退回" : "本次执行扣除的积分"}>{row.refunded ? `已退 ${row.pointCost}` : `${row.pointCost} 积分`}</span>}
                      {selected ? <span className={styles.historyViewing}>正在查看</span> : null}
                    </span>
                  </button>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开来源链接" title="打开来源链接"><ArrowUpRight aria-hidden /></a>
                </article>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE ? (
        <nav className={styles.historyPager} aria-label="使用记录分页">
          <span>第 {page} / {pageCount} 页</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
          </div>
        </nav>
      ) : null}
    </aside>
  );
}
