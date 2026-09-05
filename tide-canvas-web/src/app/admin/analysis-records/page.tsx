"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminTable,
  FilterChips,
  Panel,
  StatusPill,
  TableSkeleton,
  type Column,
  type StatusPillProps,
} from "@/components/admin";
import { adminSocialRecordsApi } from "@/lib/admin-social-records-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { SocialActivityRecordVO, SocialActivityStatus, SocialActivityType } from "@/types/social-record";

const PAGE_SIZE = 20;

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

const TYPE_OPTIONS: Array<{ label: string; value: "" | SocialActivityType }> = [
  { label: "全部记录", value: "" },
  { label: "内容分析", value: "analysis" },
  { label: "视频下载", value: "download" },
];

const STATUS_OPTIONS: Array<{ label: string; value: "" | SocialActivityStatus }> = [
  { label: "全部状态", value: "" },
  { label: "成功", value: "succeeded" },
  { label: "处理中", value: "processing" },
  { label: "待下载", value: "ready" },
  { label: "下载中", value: "downloading" },
  { label: "已过期", value: "expired" },
  { label: "失败", value: "failed" },
];

function fmtTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function fmtBytes(value?: number): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current >= 100 || unit === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unit]}`;
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value || "—";
  }
}

function recordStatus(status: SocialActivityStatus): { label: string; tone: StatusPillProps["tone"] } {
  switch (status) {
    case "succeeded": return { label: "成功", tone: "green" };
    case "failed": return { label: "失败", tone: "red" };
    case "expired": return { label: "已过期", tone: "gray" };
    case "ready": return { label: "待下载", tone: "blue" };
    case "downloading": return { label: "下载中", tone: "amber" };
    default: return { label: "处理中", tone: "amber" };
  }
}

function recordKind(row: SocialActivityRecordVO): string {
  if (row.type === "download") return row.quality ? `${QUALITY_LABEL[row.quality] || row.quality}画质` : "视频文件";
  if (row.kind === "account") return "账号分析";
  return "作品分析";
}

export default function AdminAnalysisRecordsPage() {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const requestRef = useRef(0);
  const [rows, setRows] = useState<SocialActivityRecordVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"" | SocialActivityType>("");
  const [status, setStatus] = useState<"" | SocialActivityStatus>("");
  const [platform, setPlatform] = useState("");
  const [userKeywordDraft, setUserKeywordDraft] = useState("");
  const [userKeyword, setUserKeyword] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const requestID = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      if (!await ensureSession()) return;
      const response = await adminSocialRecordsApi.list({
        pageNum: page,
        pageSize: PAGE_SIZE,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(platform ? { platform } : {}),
        ...(userKeyword.trim() ? { userKeyword: userKeyword.trim() } : {}),
        ...(keyword ? { keyword } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      if (requestID !== requestRef.current) return;
      if (!response.success || !response.data) {
        setError(response.message || "记录加载失败");
        return;
      }
      setRows(response.data.records);
      setTotal(response.data.total);
    } catch {
      if (requestID === requestRef.current) setError("记录加载失败，请稍后重试");
    } finally {
      if (requestID === requestRef.current) setLoading(false);
    }
  }, [endDate, ensureSession, keyword, page, platform, startDate, status, type, userKeyword]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current += 1;
    };
  }, [load]);

  const applyAndFirstPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const columns = useMemo<Column<SocialActivityRecordVO>[]>(() => [
    {
      header: "类型",
      width: 100,
      cell: (row) => <StatusPill tone={row.type === "analysis" ? "blue" : "green"}>{row.type === "analysis" ? "分析" : "下载"}</StatusPill>,
    },
    {
      header: "用户",
      width: 170,
      cell: (row) => <div className="srec-user"><b>{row.userName || row.userId}</b><small>{row.userEmail || row.userId}</small></div>,
    },
    {
      header: "内容",
      cell: (row) => (
        <div className="srec-content">
          <b title={row.title || row.sourceUrl}>{row.title || "未命名记录"}</b>
          <small title={row.sourceUrl}>{sourceHost(row.sourceUrl)} · {recordKind(row)}</small>
          {row.errorMessage ? <em title={row.errorMessage}>{row.errorMessage}</em> : null}
        </div>
      ),
    },
    {
      header: "平台",
      width: 110,
      cell: (row) => PLATFORM_LABEL[row.platform || ""] || row.platform || "待识别",
    },
    {
      header: "状态",
      width: 100,
      cell: (row) => {
        const current = recordStatus(row.status);
        return <StatusPill tone={current.tone}>{current.label}</StatusPill>;
      },
    },
    {
      header: "积分",
      width: 110,
      cell: (row) => row.pointCost ? `${row.pointCost} 积分${row.refunded ? " · 已退回" : ""}` : "历史未计费",
    },
    {
      header: "文件",
      width: 120,
      cell: (row) => row.type === "download"
        ? <div className="srec-file"><b>{fmtBytes(row.downloadedBytes || row.estimatedBytes)}</b><small>{row.width && row.height ? `${row.width}×${row.height}` : "—"}</small></div>
        : "—",
    },
    {
      header: "时间",
      width: 170,
      cell: (row) => <span title={fmtTime(row.completedAt)}>{fmtTime(row.createTime)}</span>,
    },
    {
      header: "来源",
      width: 72,
      align: "right",
      cell: (row) => <a className="srec-open" href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开来源链接"><ExternalLink aria-hidden size={14} /></a>,
    },
  ], []);

  const activeTypeLabel = TYPE_OPTIONS.find((option) => option.value === type)?.label || TYPE_OPTIONS[0].label;

  return (
    <div className="adm-page srec-page">
      <Panel
        title="分析记录"
        sub="查看内容分析与公开视频下载的用户活动；下载成功以文件流完整传输为准"
        tools={
          <div className="adm-tools">
            <FilterChips
              options={TYPE_OPTIONS.map((option) => option.label)}
              value={activeTypeLabel}
              label="记录类型"
              onChange={(_, index) => applyAndFirstPage(setType)(TYPE_OPTIONS[index].value)}
            />
            <button type="button" className="adm-btn ghost" onClick={() => void load()}><RefreshCw aria-hidden size={14} />刷新</button>
          </div>
        }
      >
        <form
          className="adm-filter-row srec-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setKeyword(keywordDraft.trim());
            setUserKeyword(userKeywordDraft.trim());
            setPage(1);
          }}
        >
          <div className="adm-search" role="search">
            <Search aria-hidden size={14} />
            <input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="标题 / 来源链接" aria-label="搜索记录" maxLength={100} />
          </div>
          <input className="srec-user-input" value={userKeywordDraft} onChange={(event) => setUserKeywordDraft(event.target.value)} placeholder="用户名 / 邮箱 / ID" aria-label="按用户筛选" maxLength={100} />
          <select className="genr-select" value={platform} onChange={(event) => applyAndFirstPage(setPlatform)(event.target.value)} aria-label="平台筛选">
            <option value="">全部平台</option>
            {Object.entries(PLATFORM_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="genr-select" value={status} onChange={(event) => applyAndFirstPage(setStatus)(event.target.value as "" | SocialActivityStatus)} aria-label="状态筛选">
            {STATUS_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
          </select>
          <input type="date" className="genr-date" value={startDate} onChange={(event) => applyAndFirstPage(setStartDate)(event.target.value)} aria-label="开始日期" />
          <input type="date" className="genr-date" value={endDate} onChange={(event) => applyAndFirstPage(setEndDate)(event.target.value)} aria-label="结束日期" />
          <button type="submit" className="adm-btn ghost">筛选</button>
        </form>

        {loading ? <TableSkeleton /> : error ? (
          <div className="srec-feedback"><AdminAlert tone="error" title="记录加载失败" action={<button type="button" className="adm-btn ghost" onClick={() => void load()}>重新加载</button>}>{error}</AdminAlert></div>
        ) : rows.length === 0 ? (
          <AdminEmptyState title="没有找到记录" description="用户完成内容分析或解析、下载公开视频后，记录会出现在这里。" />
        ) : (
          <AdminTable rows={rows} rowKey={(row) => row.id} columns={columns} label="分析与下载记录" server={{ page, pageSize: PAGE_SIZE, total, onPage: setPage }} />
        )}
      </Panel>

      <style>{`
        .srec-filters { align-items: center; }
        .srec-filters .adm-search { margin: 0; min-width: 220px; }
        .srec-user-input { height: 34px; min-width: 160px; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); color: var(--text); font: inherit; font-size: 12px; outline: none; }
        .srec-user-input:focus { border-color: var(--accent); }
        .srec-user,.srec-content,.srec-file { min-width: 0; }
        .srec-user b,.srec-user small,.srec-content b,.srec-content small,.srec-content em,.srec-file b,.srec-file small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srec-user b,.srec-content b,.srec-file b { font-size: 12px; font-weight: 600; }
        .srec-user small,.srec-content small,.srec-file small { margin-top: 4px; color: var(--text-faint); font-size: 12px; font-weight: 400; }
        .srec-content em { max-width: 420px; margin-top: 4px; color: var(--danger); font-size: 12px; font-style: normal; }
        .srec-open { display: inline-grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--border); border-radius: var(--r); color: var(--text-dim); }
        .srec-open:hover { border-color: var(--border-strong); color: var(--text); }
        .srec-feedback { padding: 16px; }
        @media (max-width: 900px) { .srec-filters .adm-search,.srec-user-input { width: 100%; min-width: 0; } }
      `}</style>
    </div>
  );
}
