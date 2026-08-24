"use client";

/* ============================================================================
   /admin/balances — supplier balance monitor.

   Credentials remain in the Go service. This page polls the aggregate admin
   endpoint and presents current/last-known balances without ever calling a
   supplier from the browser.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminTable,
  Panel,
  StatusPill,
  TableSkeleton,
  type Column,
} from "@/components/admin";
import { adminBalancesApi } from "@/lib/admin-balances-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { PillTone } from "@/components/admin/admin-constants";
import type {
  SupplierBalancesVO,
  SupplierBalanceState,
  SupplierBalanceVO,
} from "@/types/admin-balances";

const DEFAULT_REFRESH_SECONDS = 30;

const STATE_META: Record<SupplierBalanceState, { label: string; tone: PillTone }> = {
  healthy: { label: "正常", tone: "green" },
  low: { label: "余额偏低", tone: "amber" },
  error: { label: "查询异常", tone: "red" },
  unconfigured: { label: "未配置", tone: "gray" },
  disabled: { label: "已停用", tone: "gray" },
};

function formatMoney(value: number | null, currency: string): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${currency}`.trim();
  }
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function supplierInitial(name: string): string {
  const text = name.trim();
  return (text.slice(0, 2) || "—").toUpperCase();
}

export default function AdminBalancesPage() {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [snapshot, setSnapshot] = useState<SupplierBalancesVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setRefreshing(true);
      setError(null);
      try {
        await ensureSession();
        const result = await adminBalancesApi.snapshot();
        if (id !== requestId.current) return;
        if (result.success && result.data) {
          setSnapshot(result.data);
        } else {
          setError(result.message || "供应商余额加载失败");
        }
      } catch {
        if (id !== requestId.current) return;
        setError("供应商余额加载失败，请稍后重试");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [ensureSession],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const refreshSeconds = Math.max(snapshot?.refreshSeconds || DEFAULT_REFRESH_SECONDS, 10);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [load, refreshSeconds]);

  const rows = useMemo(() => snapshot?.suppliers ?? [], [snapshot?.suppliers]);
  const counts = useMemo(() => {
    const connected = rows.filter((row) => row.state === "healthy" || row.state === "low").length;
    const low = rows.filter((row) => row.state === "low").length;
    const errors = rows.filter((row) => row.state === "error").length;
    const pending = rows.filter((row) => row.state === "unconfigured" || row.state === "disabled").length;
    return { connected, low, errors, pending };
  }, [rows]);

  const columns = useMemo<Column<SupplierBalanceVO>[]>(
    () => [
      {
        header: "供应商",
        width: "20%",
        cell: (row) => (
          <div className="balance-supplier">
            <span className="balance-avatar" aria-hidden>{supplierInitial(row.name)}</span>
            <span className="balance-supplier-copy">
              <strong>{row.name}</strong>
              <small>{row.source || "—"}</small>
            </span>
          </div>
        ),
        sortable: true,
        sortValue: (row) => row.name,
      },
      {
        header: "可用余额",
        width: "18%",
        cell: (row) => (
          <div>
            <div className={`balance-value${row.state === "low" ? " is-low" : ""}`}>
              {formatMoney(row.balance, row.currency)}
            </div>
            {row.stale ? (
              <div className="balance-cell-sub is-stale">最近成功值</div>
            ) : row.lowBalance != null ? (
              <div className="balance-cell-sub">预警线 {formatMoney(row.lowBalance, row.currency)}</div>
            ) : null}
          </div>
        ),
        sortable: true,
        sortValue: (row) => row.balance ?? Number.NEGATIVE_INFINITY,
      },
      {
        header: "状态",
        width: "13%",
        cell: (row) => {
          const meta = STATE_META[row.state] ?? STATE_META.error;
          return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
        },
        sortable: true,
        sortValue: (row) => row.state,
      },
      {
        header: "额度明细",
        width: "15%",
        cell: (row) => row.details.length ? (
          <span className="balance-details">
            {row.details.slice(0, 2).map((detail) => (
              <span key={detail.label}>
                <small>{detail.label}</small>
                <b>{formatMoney(detail.value, detail.currency)}</b>
              </span>
            ))}
          </span>
        ) : <span className="balance-muted-value">—</span>,
        sortable: true,
        sortValue: (row) => row.details[0]?.value ?? Number.NEGATIVE_INFINITY,
      },
      {
        header: "最近成功",
        width: "17%",
        cell: (row) => (
          <div>
            <div className="balance-time">{formatDateTime(row.lastSuccessAt)}</div>
            {row.checkedAt ? <div className="balance-cell-sub">响应 {row.latencyMs.toLocaleString()} ms</div> : null}
          </div>
        ),
        sortable: true,
        sortValue: (row) => row.lastSuccessAt || "",
      },
      {
        header: "说明",
        width: "17%",
        cell: (row) => (
          <span className={`balance-message is-${row.state}`} title={row.message}>
            {row.message || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="adm-page balance-page">
      <Panel
        title="供应商余额"
        sub={`服务端安全查询 · 每 ${refreshSeconds} 秒自动刷新 · 单个供应商异常不影响其他数据`}
        tools={
          <div className="balance-tools">
            <span className="balance-live" title="页面可见时自动刷新">
              <i aria-hidden />
              实时监控
            </span>
            <button
              type="button"
              className="adm-btn ghost"
              disabled={refreshing}
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden size={14} className={refreshing ? "balance-spin" : undefined} />
              {refreshing ? "刷新中" : "刷新"}
            </button>
          </div>
        }
      >
        {error ? (
          <div className="balance-alert-wrap">
            <AdminAlert
              tone="error"
              title="余额监控加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={() => void load()}>
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          </div>
        ) : null}

        {loading && !snapshot ? (
          <TableSkeleton rows={4} cols={6} />
        ) : error && !snapshot ? null : rows.length === 0 ? (
          <AdminEmptyState
            title="暂无供应商"
            description="在服务端余额监控配置中加入供应商后，会自动显示在这里。"
          />
        ) : (
          <>
            <div className="balance-overview" aria-label="供应商余额监控概况">
              <OverviewItem label="供应商" value={rows.length} />
              <OverviewItem label="已连接" value={counts.connected} tone="ok" />
              <OverviewItem label="低余额" value={counts.low} tone={counts.low ? "warn" : undefined} />
              <OverviewItem label="异常" value={counts.errors} tone={counts.errors ? "danger" : undefined} />
              <OverviewItem label="待配置" value={counts.pending} />
              <span className="balance-refreshed">
                本轮完成于 {formatDateTime(snapshot?.refreshedAt || "")}
              </span>
            </div>
            <AdminTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.key}
              label="供应商余额列表"
            />
          </>
        )}
      </Panel>

      <style>{`
        .balance-tools { display: flex; align-items: center; gap: 12px; }
        .balance-live {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--text-faint);
          font-size: 12px;
          white-space: nowrap;
        }
        .balance-live i {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--ok);
        }
        .balance-alert-wrap { padding: 16px 16px 0; }
        .balance-overview {
          display: flex;
          align-items: stretch;
          gap: 0;
          min-height: 72px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
        }
        .balance-overview-item {
          display: flex;
          min-width: 104px;
          flex-direction: column;
          justify-content: center;
          padding: 0 20px;
          border-right: 1px solid var(--border);
        }
        .balance-overview-item:first-child { padding-left: 4px; }
        .balance-overview-item span { color: var(--text-faint); font-size: 11.5px; }
        .balance-overview-item strong {
          margin-top: 2px;
          color: var(--text-title);
          font-size: 20px;
          font-weight: 650;
          line-height: 1.2;
        }
        .balance-overview-item strong.ok { color: var(--ok); }
        .balance-overview-item strong.warn { color: var(--warn); }
        .balance-overview-item strong.danger { color: var(--danger); }
        .balance-refreshed {
          align-self: center;
          margin-left: auto;
          padding-left: 20px;
          color: var(--text-faint);
          font-size: 12px;
          white-space: nowrap;
        }
        .balance-supplier { display: flex; min-width: 0; align-items: center; gap: 10px; }
        .balance-avatar {
          display: grid;
          width: 34px;
          height: 34px;
          flex: none;
          place-items: center;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--surface-2);
          color: var(--text-dim);
          font-size: 10px;
          font-weight: 650;
          letter-spacing: .02em;
        }
        .balance-supplier-copy { display: flex; min-width: 0; flex-direction: column; }
        .balance-supplier-copy strong {
          overflow: hidden;
          color: var(--text-title);
          font-size: 13.5px;
          font-weight: 600;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-supplier-copy small {
          overflow: hidden;
          margin-top: 2px;
          color: var(--text-faint);
          font-size: 11.5px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-value {
          color: var(--text-title);
          font-size: 15px;
          font-weight: 650;
          font-variant-numeric: tabular-nums;
        }
        .balance-value.is-low { color: var(--warn); }
        .balance-muted-value, .balance-time {
          color: var(--text-dim);
          font-size: 12.5px;
          font-variant-numeric: tabular-nums;
        }
        .balance-details { display: flex; flex-direction: column; gap: 3px; }
        .balance-details > span { display: flex; align-items: baseline; gap: 6px; }
        .balance-details small { color: var(--text-faint); font-size: 10.5px; }
        .balance-details b {
          color: var(--text-dim);
          font-size: 11.5px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }
        .balance-cell-sub { margin-top: 3px; color: var(--text-faint); font-size: 11px; }
        .balance-cell-sub.is-stale { color: var(--warn); }
        .balance-message {
          display: block;
          overflow: hidden;
          color: var(--text-faint);
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-message.is-error { color: var(--danger); }
        .balance-message.is-low { color: var(--warn); }
        .balance-message.is-unconfigured { color: var(--text-dim); }
        .balance-spin { animation: balanceSpin .8s linear infinite; }
        @keyframes balanceSpin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .balance-overview { overflow-x: auto; }
          .balance-overview-item { min-width: 96px; padding: 0 16px; }
          .balance-refreshed { display: none; }
        }
      `}</style>
    </div>
  );
}

function OverviewItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <span className="balance-overview-item">
      <span>{label}</span>
      <strong className={tone}>{value.toLocaleString("zh-CN")}</strong>
    </span>
  );
}
