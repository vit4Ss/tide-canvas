"use client";

/* ============================================================================
   /admin/logs — 日志管理 (multi-tab).

   Wired to the real backend log surface:
     系统日志  GET /api/admin/logs          -> PageData<LogVO>          (model.SysLog)
     请求日志  GET /api/admin/logs/access   -> PageData<AccessLogVO>    (model.AccessLog)
     登录日志  GET /api/admin/logs/login    -> PageData<LoginLogVO>     (model.LoginLog)
     业务日志  GET /api/admin/logs/business -> PageData<BizLogVO>       (model.BizLog)
     模型日志  GET /api/admin/logs/model    -> PageData<ModelCallLogVO> (model.ModelCallLog)

   Each tab is a server-paged table with a keyword search + refresh. The 模型日志
   tab shows the upstream request/response bodies (truncated, full text on hover).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminTable,
  FilterChips,
  Panel,
  StatusPill,
  type Column,
  type StatusPillProps,
} from "@/components/admin";
import { adminLogsApi } from "@/lib/admin-logs-api";
import type {
  LogVO,
  LogQuery,
  AccessLogVO,
  LoginLogVO,
  BizLogVO,
  ModelCallLogVO,
} from "@/types/admin-logs";
import type { PageData, Result } from "@/types/api";
import { useAuthStore } from "@/stores/use-auth-store";

type PillTone = StatusPillProps["tone"];

const TABS = ["系统", "请求", "登录", "业务", "模型"] as const;
type Tab = (typeof TABS)[number];

/** HTTP status → pill tone (2xx green, 3xx blue, 4xx amber, 5xx/err red). */
function statusTone(status: number): PillTone {
  if (status >= 500 || status === 0) return "red";
  if (status >= 400) return "amber";
  if (status >= 300) return "blue";
  if (status >= 200) return "green";
  return "gray";
}

function okTone(success: number): PillTone {
  return success === 1 ? "green" : "red";
}

/** Shorten a long body for a table cell; full text shows on hover. */
function clip(s: string, n = 80): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ── generic server-paged log table ──────────────────────────────────────── */

interface LogTableProps<T extends { id: string }> {
  load: (q: LogQuery) => Promise<Result<PageData<T>>>;
  columns: Column<T>[];
  searchPlaceholder: string;
  /** optional discrete filter chips → backend query patch */
  chips?: readonly string[];
  chipToQuery?: (chip: string) => Partial<LogQuery>;
}

function LogTable<T extends { id: string }>({
  load,
  columns,
  searchPlaceholder,
  chips,
  chipToQuery,
}: LogTableProps<T>) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(chips?.[0] ?? "");

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await load({
        pageNum: 1,
        pageSize: 100,
        keyword: query.trim() || undefined,
        ...(chipToQuery ? chipToQuery(chip) : {}),
      });
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载日志失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      setError("加载日志失败");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, load, query, chip, chipToQuery]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <Panel
      title="日志明细"
      sub={`共 ${total} 条`}
      tools={
        <>
          <div className="adm-search" style={{ margin: 0 }}>
            <span className="muted">⌕</span>
            <input
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {chips && chipToQuery ? (
            <FilterChips options={[...chips]} value={chip} onChange={setChip} />
          ) : null}
          <button type="button" className="adm-btn ghost" onClick={() => run()}>
            刷新
          </button>
        </>
      }
    >
      {loading ? (
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          加载中…
        </div>
      ) : error ? (
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          暂无日志记录
        </div>
      ) : (
        <AdminTable<T> rows={rows} rowKey={(r) => r.id} columns={columns} pageSize={20} total={total} />
      )}
    </Panel>
  );
}

/* ── per-tab column configs ──────────────────────────────────────────────── */

const timeCol = <T extends { createTime: string }>(): Column<T> => ({
  header: "时间",
  className: "mono muted",
  cell: (r) => r.createTime || "—",
});

function SystemTab() {
  const columns: Column<LogVO>[] = useMemo(
    () => [
      timeCol<LogVO>(),
      { header: "级别", cell: (l) => <StatusPill tone={l.level === "ERROR" ? "red" : l.level === "WARN" ? "amber" : "gray"}>{l.level || "—"}</StatusPill> },
      { header: "模块", className: "mono", cell: (l) => l.module || "—" },
      { header: "信息", className: "strong", cell: (l) => l.message },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
      { header: "操作人", cell: (l) => l.operator || "—" },
    ],
    [],
  );
  return <LogTable<LogVO> load={adminLogsApi.list} columns={columns} searchPlaceholder="搜索信息 / 操作人" />;
}

function AccessTab() {
  const columns: Column<AccessLogVO>[] = useMemo(
    () => [
      timeCol<AccessLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => (l.userId === "0" ? "游客" : l.userId) },
      { header: "方法", className: "mono", cell: (l) => l.method },
      { header: "路径", className: "mono strong", cell: (l) => l.path },
      { header: "状态", cell: (l) => <StatusPill tone={statusTone(l.status)}>{l.status}</StatusPill> },
      { header: "耗时", className: "mono muted", cell: (l) => `${l.latencyMs}ms` },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
    ],
    [],
  );
  return <LogTable<AccessLogVO> load={adminLogsApi.access} columns={columns} searchPlaceholder="搜索路径 / IP" />;
}

function LoginTab() {
  const columns: Column<LoginLogVO>[] = useMemo(
    () => [
      timeCol<LoginLogVO>(),
      { header: "账号", className: "strong", cell: (l) => l.account || "—" },
      { header: "动作", className: "mono", cell: (l) => l.action },
      { header: "渠道", className: "mono muted", cell: (l) => l.channel || "—" },
      { header: "结果", cell: (l) => <StatusPill tone={okTone(l.success)}>{l.success === 1 ? "成功" : "失败"}</StatusPill> },
      { header: "原因", className: "muted", cell: (l) => l.failReason || "—" },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
    ],
    [],
  );
  return <LogTable<LoginLogVO> load={adminLogsApi.login} columns={columns} searchPlaceholder="搜索账号 / IP" />;
}

function BizTab() {
  const columns: Column<BizLogVO>[] = useMemo(
    () => [
      timeCol<BizLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => l.userId },
      { header: "动作", className: "mono", cell: (l) => l.action },
      { header: "摘要", className: "strong", cell: (l) => l.summary || "—" },
      { header: "金额", className: "mono", cell: (l) => (Number(l.amount) > 0 ? `¥${l.amount}` : "—") },
      { header: "积分", className: "mono", cell: (l) => (l.points ? (l.points > 0 ? `+${l.points}` : String(l.points)) : "—") },
      { header: "操作人", className: "mono muted", cell: (l) => (l.operatorId === "0" ? "系统" : l.operatorId) },
    ],
    [],
  );
  return <LogTable<BizLogVO> load={adminLogsApi.business} columns={columns} searchPlaceholder="搜索摘要 / 备注" />;
}

function ModelTab() {
  const columns: Column<ModelCallLogVO>[] = useMemo(
    () => [
      timeCol<ModelCallLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => l.userId },
      { header: "场景", cell: (l) => <StatusPill tone="blue">{l.scene}</StatusPill> },
      { header: "模型", className: "mono strong", cell: (l) => l.model || "—" },
      { header: "结果", cell: (l) => <StatusPill tone={okTone(l.success)}>{l.success === 1 ? "成功" : "失败"}</StatusPill> },
      { header: "耗时", className: "mono muted", cell: (l) => `${l.durationMs}ms` },
      { header: "请求参数", className: "mono muted", cell: (l) => <span title={l.requestBody}>{clip(l.requestBody)}</span> },
      { header: "返回参数", className: "mono muted", cell: (l) => <span title={l.success === 1 ? l.responseBody : l.errorMsg}>{clip(l.success === 1 ? l.responseBody : l.errorMsg)}</span> },
    ],
    [],
  );
  return <LogTable<ModelCallLogVO> load={adminLogsApi.model} columns={columns} searchPlaceholder="搜索模型" />;
}

export default function AdminLogsPage() {
  const [tab, setTab] = useState<Tab>("系统");

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <FilterChips options={[...TABS]} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>
      {tab === "系统" ? <SystemTab /> : null}
      {tab === "请求" ? <AccessTab /> : null}
      {tab === "登录" ? <LoginTab /> : null}
      {tab === "业务" ? <BizTab /> : null}
      {tab === "模型" ? <ModelTab /> : null}
    </>
  );
}
