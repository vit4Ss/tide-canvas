"use client";

/* ============================================================================
   /admin/logs — 日志管理.

   Faithful port of admin.js V.logs(), now wired to the REAL backend:
     GET /api/admin/logs (paged, level?/module?/keyword? filters) -> PageData<LogVO>

     - 4 KPI cards (今日日志 / 错误率 / 告警 / 平均响应) — static display chrome.
     - 系统日志 panel: filter chips (全部 / 操作审计 / 错误 / 安全 / 支付) + 搜索,
       then the log table (时间 / 级别 / 模块 / 操作·信息 / 来源 IP / 操作人).

   The filter chips drive the backend level/module filters:
     操作审计 → level=INFO, 错误 → level=ERROR, 安全 → level=SECURITY,
     支付 → module=pay. 全部 → no filter. Search box → keyword.

   Client component (filter state, server-paged table, loading/empty states).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminTable,
  FilterChips,
  Panel,
  StatCardGrid,
  StatusPill,
  type Column,
  type StatCardProps,
  type StatusPillProps,
} from "@/components/admin";
import { adminLogsApi } from "@/lib/admin-logs-api";
import type { LogVO, LogQuery } from "@/types/admin-logs";
import { useAuthStore } from "@/stores/use-auth-store";

/* ── static display chrome (no longer sourced from @/mock) ───────────────── */

type PillTone = StatusPillProps["tone"];

const LOG_KPIS: StatCardProps[] = [
  { k: "今日日志", v: "2,418,902", dir: "up" },
  { k: "错误率", v: "0.04%", d: "-0.01%", dir: "up" },
  { k: "告警", v: "12", dir: "down" },
  { k: "平均响应", v: "142ms", d: "-8ms", dir: "up" },
];

const LOG_FILTERS = ["全部", "操作审计", "错误", "安全", "支付"] as const;

/** Level → status-pill tone (INFO=gray, WARN=amber, ERROR=red, SECURITY=blue). */
function levelTone(level: string): PillTone {
  switch (level.toUpperCase()) {
    case "ERROR":
      return "red";
    case "WARN":
      return "amber";
    case "SECURITY":
      return "blue";
    case "INFO":
    default:
      return "gray";
  }
}

/** Translate a filter chip into backend level/module query params. */
function filterToQuery(filter: string): Pick<LogQuery, "level" | "module"> {
  switch (filter) {
    case "操作审计":
      return { level: "INFO" };
    case "错误":
      return { level: "ERROR" };
    case "安全":
      return { level: "SECURITY" };
    case "支付":
      return { module: "pay" };
    default:
      return {};
  }
}

export default function AdminLogsPage() {
  const [filter, setFilter] = useState<string>(LOG_FILTERS[0]);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminLogsApi.list({
        pageNum: 1,
        pageSize: 100,
        keyword: query.trim() || undefined,
        ...filterToQuery(filter),
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
  }, [ensureSession, filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<LogVO>[] = useMemo(
    () => [
      {
        header: "时间",
        className: "mono muted",
        sortable: true,
        sortValue: (l) => l.createTime,
        cell: (l) => l.createTime || "—",
      },
      {
        header: "级别",
        cell: (l) => <StatusPill tone={levelTone(l.level)}>{l.level || "—"}</StatusPill>,
      },
      { header: "模块", className: "mono", cell: (l) => l.module || "—" },
      { header: "操作 / 信息", className: "strong", cell: (l) => l.message },
      { header: "来源 IP", className: "mono muted", cell: (l) => l.ip || "—" },
      { header: "操作人", cell: (l) => l.operator || "—" },
    ],
    [],
  );

  return (
    <>
      <StatCardGrid items={LOG_KPIS} />

      <Panel
        title="系统日志"
        sub="操作审计、错误与安全事件"
        tools={
          <>
            <div className="adm-search" style={{ margin: 0 }}>
              <span className="muted">⌕</span>
              <input
                placeholder="搜索信息 / 操作人"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <FilterChips options={[...LOG_FILTERS]} value={filter} onChange={setFilter} />
            <button type="button" className="adm-btn ghost" onClick={() => load()}>
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
          <AdminTable<LogVO>
            rows={rows}
            rowKey={(l) => l.id}
            columns={columns}
            pageSize={20}
            total={total}
          />
        )}
      </Panel>
    </>
  );
}
