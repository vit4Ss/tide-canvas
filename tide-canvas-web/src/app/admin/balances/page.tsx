"use client";

/* ============================================================================
   /admin/balances — supplier balance monitor.

   Credentials remain in the Go service. This page polls the aggregate admin
   endpoint and presents current/last-known balances without ever calling a
   supplier from the browser.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
} from "@/components/admin";
import { adminBalancesApi } from "@/lib/admin-balances-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type {
  SupplierBalancesVO,
  SupplierBalanceState,
  SupplierBalanceVO,
} from "@/types/admin-balances";

const DEFAULT_REFRESH_SECONDS = 30;

const STATE_META: Record<SupplierBalanceState, { label: string }> = {
  healthy: { label: "运行正常" },
  low: { label: "余额预警" },
  error: { label: "查询异常" },
  unconfigured: { label: "等待接入" },
  disabled: { label: "监控停用" },
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
    const healthy = rows.filter((row) => row.state === "healthy").length;
    const low = rows.filter((row) => row.state === "low").length;
    const errors = rows.filter((row) => row.state === "error").length;
    const inactive = rows.filter((row) => row.state === "unconfigured" || row.state === "disabled").length;
    return { connected: healthy + low, healthy, low, errors, inactive };
  }, [rows]);

  const liveUSD = useMemo(() => {
    const connected = rows.filter(
      (row) =>
        (row.state === "healthy" || row.state === "low") &&
        row.currency.toUpperCase() === "USD" &&
        row.balance != null,
    );
    if (connected.length === 0) return null;
    return connected.reduce((sum, row) => sum + (row.balance ?? 0), 0);
  }, [rows]);

  return (
    <div className="adm-page balance-page">
      <section className="balance-command" aria-labelledby="balance-title">
        <div className="balance-command-top">
          <div className="balance-command-copy">
            <h1 id="balance-title">供应商余额</h1>
            <p>集中观察上游账户余额、额度健康度与认证状态，异常账户不会阻塞其他供应商。</p>
          </div>
          <button
            type="button"
            className="adm-btn balance-refresh"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden size={15} className={refreshing ? "balance-spin" : undefined} />
            {refreshing ? "同步中" : "立即同步"}
          </button>
        </div>

        <div className="balance-command-grid" role="group" aria-label="资金监控概况">
          <div className="balance-total">
            <div>
              <span>在线美元余额</span>
              <strong>{liveUSD == null ? "—" : formatMoney(liveUSD, "USD")}</strong>
              <small>{counts.connected} / {rows.length || "—"} 个账户已连接</small>
            </div>
          </div>
          <CommandMetric label="健康账户" value={counts.healthy} />
          <CommandMetric label="余额预警" value={counts.low} tone="warn" />
          <CommandMetric label="查询异常" value={counts.errors} tone="danger" />
          <CommandMetric label="未在监控" value={counts.inactive} />
          <div className="balance-sync-time">
            <Clock3 aria-hidden size={14} />
            <span>最近同步</span>
            <strong>{formatDateTime(snapshot?.refreshedAt || "")}</strong>
            <small>自动刷新 · {refreshSeconds}s</small>
          </div>
        </div>
      </section>

      {error ? (
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
      ) : null}

      <section className="balance-ledger" aria-labelledby="balance-ledger-title">
        <header className="balance-ledger-head">
          <div>
            <h2 id="balance-ledger-title">供应商账户</h2>
            <p>余额与状态来自最近一次服务端查询。</p>
          </div>
          <div className="balance-ledger-security">
            <ShieldCheck aria-hidden size={15} />
            凭据仅由服务端读取
          </div>
        </header>

        {loading && !snapshot ? (
          <BalanceListSkeleton />
        ) : error && !snapshot ? null : rows.length === 0 ? (
          <div className="balance-empty">
            <AdminEmptyState
              title="暂无供应商"
              description="请先在后台配置管理的「供应商余额」分组中启用并填写访问令牌。"
            />
          </div>
        ) : (
          <div className="balance-account-list">
            <BalanceAccountHeader />
            {rows.map((row) => <SupplierBalanceRow key={row.key} row={row} />)}
          </div>
        )}
      </section>

      <style>{`
        .balance-page {
          gap: 24px;
        }
        .balance-command {
          padding: 24px;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .balance-command-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }
        .balance-command-copy { max-width: 700px; }
        .balance-command h1 {
          margin: 0;
          color: var(--text-title);
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -.02em;
          line-height: 1.3;
          text-wrap: balance;
        }
        .balance-command-copy p {
          max-width: 68ch;
          margin: 8px 0 0;
          color: var(--text-faint);
          font-size: 13px;
          line-height: 1.6;
          text-wrap: pretty;
        }
        .balance-refresh {
          flex: none;
          min-width: 112px;
        }
        .balance-command-grid {
          display: grid;
          grid-template-columns: minmax(240px, 1.6fr) repeat(4, minmax(88px, .58fr)) minmax(168px, 1fr);
          margin-top: 24px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--surface-2);
        }
        .balance-total {
          display: flex;
          min-width: 0;
          align-items: center;
          padding: 16px 20px;
          border-right: 1px solid var(--border);
          background: var(--surface);
        }
        .balance-total span,
        .balance-command-metric span,
        .balance-sync-time span {
          display: block;
          color: var(--text-faint);
          font-size: 12px;
          font-weight: 400;
        }
        .balance-total strong {
          display: block;
          overflow: hidden;
          margin-top: 8px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -.025em;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-total small,
        .balance-sync-time small {
          display: block;
          margin-top: 4px;
          color: var(--text-faint);
          font-size: 11px;
          white-space: nowrap;
        }
        .balance-command-metric {
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 16px;
          border-right: 1px solid var(--border);
          background: var(--surface-2);
        }
        .balance-command-metric strong {
          margin-top: 8px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 20px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .balance-command-metric.is-warn {
          background: var(--warn-soft);
        }
        .balance-command-metric.is-warn span,
        .balance-command-metric.is-warn strong { color: var(--warn-strong); }
        .balance-command-metric.is-danger {
          background: var(--danger-soft);
        }
        .balance-command-metric.is-danger span,
        .balance-command-metric.is-danger strong { color: var(--danger-strong); }
        .balance-sync-time {
          position: relative;
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 16px 16px 16px 40px;
          background: var(--surface);
        }
        .balance-sync-time > svg {
          position: absolute;
          top: 18px;
          left: 16px;
          color: var(--text-faint);
        }
        .balance-sync-time strong {
          overflow: hidden;
          margin-top: 8px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 11.5px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-ledger {
          min-width: 0;
        }
        .balance-ledger-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }
        .balance-ledger-head h2 {
          margin: 0;
          color: var(--text-title);
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -.01em;
        }
        .balance-ledger-head p {
          margin: 4px 0 0;
          color: var(--text-faint);
          font-size: 12px;
          line-height: 1.5;
        }
        .balance-ledger-security {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--text-faint);
          font-size: 12px;
        }
        .balance-ledger-security svg { color: var(--ok); }
        .balance-account-list {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .balance-account-head,
        .balance-account-row {
          display: grid;
          grid-template-columns: minmax(176px, 1.35fr) minmax(168px, 1.1fr) minmax(128px, .8fr) minmax(144px, 1fr) minmax(88px, .55fr) minmax(108px, .7fr);
          column-gap: 16px;
        }
        .balance-account-head {
          min-height: 40px;
          align-items: center;
          padding: 0 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface-2);
          color: var(--text-faint);
          font-size: 11px;
          font-weight: 500;
        }
        .balance-account-row {
          --account-state: var(--text-faint);
          --account-status-bg: var(--surface-2);
          --account-status-border: var(--border);
          --account-status-text: var(--text-dim);
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid var(--border-weak);
        }
        .balance-account-row:last-child { border-bottom: 0; }
        .balance-account-row.is-healthy {
          --account-state: var(--ok);
          --account-status-bg: var(--ok-soft);
          --account-status-border: color-mix(in oklab, var(--ok) 24%, var(--border));
          --account-status-text: var(--ok-strong);
        }
        .balance-account-row.is-low {
          --account-state: var(--warn);
          --account-status-bg: var(--warn-soft);
          --account-status-border: color-mix(in oklab, var(--warn) 32%, var(--border));
          --account-status-text: var(--warn-strong);
          background: color-mix(in oklab, var(--warn-soft) 58%, var(--surface));
        }
        .balance-account-row.is-error {
          --account-state: var(--danger);
          --account-status-bg: var(--danger-soft);
          --account-status-border: color-mix(in oklab, var(--danger) 28%, var(--border));
          --account-status-text: var(--danger-strong);
          background: color-mix(in oklab, var(--danger-soft) 58%, var(--surface));
        }
        .balance-account-provider {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 12px;
        }
        .balance-account-avatar {
          display: grid;
          width: 36px;
          height: 36px;
          flex: none;
          place-items: center;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--surface-2);
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 600;
        }
        .balance-account-provider-copy { min-width: 0; }
        .balance-account-provider-copy strong,
        .balance-account-provider-copy small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-account-provider-copy strong {
          color: var(--text-title);
          font-size: 14px;
          font-weight: 600;
        }
        .balance-account-provider-copy small {
          margin-top: 4px;
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 10px;
        }
        .balance-account-cell { min-width: 0; }
        .balance-cell-label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          margin: -1px;
          padding: 0;
          border: 0;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-account-cell > strong {
          display: block;
          overflow: hidden;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 12px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-account-amount > strong {
          color: var(--text-title);
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -.015em;
        }
        .balance-account-row.is-low .balance-account-amount > strong,
        .balance-account-row.is-error .balance-account-amount > strong.is-empty {
          color: var(--account-status-text);
        }
        .balance-account-amount > strong.is-empty {
          font-family: var(--ui);
          font-size: 13px;
          letter-spacing: 0;
        }
        .balance-account-stale {
          display: block;
          margin-top: 4px;
          color: var(--warn-strong);
          font-size: 11px;
          font-weight: 600;
        }
        .balance-account-details {
          display: flex;
          min-width: 0;
          flex-wrap: wrap;
          gap: 4px 12px;
          margin-top: 6px;
        }
        .balance-account-details span {
          min-width: 0;
          color: var(--text-faint);
          font-size: 10px;
        }
        .balance-account-details b {
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .balance-account-status {
          display: inline-flex;
          width: fit-content;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border: 1px solid var(--account-status-border);
          border-radius: var(--r-sm);
          background: var(--account-status-bg);
          color: var(--account-status-text);
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }
        .balance-account-status i {
          width: 6px;
          height: 6px;
          flex: none;
          border-radius: 50%;
          background: var(--account-state);
        }
        .balance-account-message {
          display: flex;
          grid-column: 1 / -1;
          align-items: flex-start;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-weak);
          color: var(--text-dim);
          font-size: 11px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }
        .balance-account-message svg {
          flex: none;
          margin-top: 2px;
          color: var(--account-state);
        }
        .balance-account-row.is-low .balance-account-message,
        .balance-account-row.is-error .balance-account-message {
          color: var(--account-status-text);
        }
        .balance-skeleton-row { min-height: 96px; }
        .balance-skeleton-provider {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .balance-skeleton-copy {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .balance-skeleton-avatar { width: 36px; height: 36px; border-radius: var(--r); }
        .balance-skeleton-name { width: 88px; height: 12px; }
        .balance-skeleton-source { width: 112px; height: 10px; }
        .balance-skeleton-value { width: 120px; height: 16px; }
        .balance-skeleton-cell { width: 96px; height: 12px; }
        .balance-skeleton-short { width: 56px; height: 12px; }
        .balance-skeleton-status { width: 72px; height: 24px; border-radius: var(--r-sm); }
        .balance-skeleton-message {
          grid-column: 1 / -1;
          width: min(420px, 72%);
          height: 10px;
          margin-top: 12px;
        }
        .balance-empty {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .balance-spin { animation: balanceSpin .8s linear infinite; }
        @keyframes balanceSpin { to { transform: rotate(360deg); } }
        @media (max-width: 1240px) {
          .balance-command-grid { grid-template-columns: minmax(232px, 1.5fr) repeat(4, minmax(80px, .6fr)); }
          .balance-sync-time { grid-column: 1 / -1; min-height: 64px; border-top: 1px solid var(--border); }
        }
        @media (max-width: 1100px) {
          .balance-account-head { display: none; }
          .balance-account-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px 24px;
          }
          .balance-account-provider,
          .balance-account-status,
          .balance-account-message,
          .balance-skeleton-provider,
          .balance-skeleton-message { grid-column: 1 / -1; }
          .balance-cell-label {
            position: static;
            display: block;
            width: auto;
            height: auto;
            overflow: visible;
            margin-bottom: 4px;
            clip: auto;
            white-space: normal;
          }
          .balance-account-message { margin-top: 0; }
        }
        @media (max-width: 820px) {
          .balance-command { padding: 20px; }
          .balance-command-top { flex-direction: column; }
          .balance-refresh { width: 100%; min-height: 44px; }
          .balance-command-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .balance-total {
            grid-column: 1 / -1;
            border-right: 0;
            border-bottom: 1px solid var(--border);
          }
          .balance-command-metric {
            border-right: 0;
            border-bottom: 1px solid var(--border);
          }
          .balance-command-metric:nth-child(even) { border-right: 1px solid var(--border); }
          .balance-sync-time { grid-column: 1 / -1; border-top: 0; }
          .balance-account-provider-copy small,
          .balance-cell-label,
          .balance-account-stale,
          .balance-account-details span,
          .balance-account-status,
          .balance-account-message { font-size: 12px; }
        }
        @media (max-width: 560px) {
          .balance-command h1 { font-size: 22px; }
          .balance-ledger-head { align-items: flex-start; flex-direction: column; }
          .balance-ledger-security { font-size: 11px; }
        }
        @media (max-width: 480px) {
          .balance-account-row { grid-template-columns: 1fr; }
          .balance-account-provider,
          .balance-account-status,
          .balance-account-message,
          .balance-skeleton-provider,
          .balance-skeleton-message { grid-column: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .balance-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}

function CommandMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger";
}) {
  const emphasized = tone && value > 0;
  return (
    <div className={`balance-command-metric${emphasized ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("zh-CN").padStart(2, "0")}</strong>
    </div>
  );
}

function BalanceAccountHeader() {
  return (
    <div className="balance-account-head" aria-hidden>
      <span>供应商</span>
      <span>可用余额</span>
      <span>预警阈值</span>
      <span>最近成功</span>
      <span>响应耗时</span>
      <span>状态</span>
    </div>
  );
}

function BalanceListSkeleton() {
  return (
    <div className="balance-account-list" aria-busy="true">
      <span className="sr-only" role="status">正在加载供应商余额</span>
      <BalanceAccountHeader />
      {Array.from({ length: 5 }, (_, index) => (
        <div className="balance-account-row balance-skeleton-row" aria-hidden key={index}>
          <div className="balance-skeleton-provider">
            <span className="skel balance-skeleton-avatar" />
            <span className="balance-skeleton-copy">
              <span className="skel balance-skeleton-name" />
              <span className="skel balance-skeleton-source" />
            </span>
          </div>
          <span className="skel balance-skeleton-value" />
          <span className="skel balance-skeleton-cell" />
          <span className="skel balance-skeleton-cell" />
          <span className="skel balance-skeleton-short" />
          <span className="skel balance-skeleton-status" />
          <span className="skel balance-skeleton-message" />
        </div>
      ))}
    </div>
  );
}

function SupplierBalanceRow({ row }: { row: SupplierBalanceVO }) {
  const meta = STATE_META[row.state] ?? STATE_META.error;
  const connected = row.balance != null;
  const emptyBalanceLabel = row.state === "error"
    ? "查询失败"
    : row.state === "disabled"
      ? "监控已停用"
      : "尚未接入";

  return (
    <article
      className={`balance-account-row is-${row.state}`}
      aria-label={`${row.name}：${meta.label}`}
    >
      <div className="balance-account-provider">
        <span className="balance-account-avatar" aria-hidden>{supplierInitial(row.name)}</span>
        <div className="balance-account-provider-copy">
          <strong>{row.name}</strong>
          <small title={row.source}>{row.source || "未配置地址"}</small>
        </div>
      </div>

      <div className="balance-account-cell balance-account-amount">
        <span className="balance-cell-label">可用余额</span>
        <strong className={connected ? undefined : "is-empty"}>
          {connected ? formatMoney(row.balance, row.currency) : emptyBalanceLabel}
        </strong>
        {row.stale ? <span className="balance-account-stale">最近成功值 · 非实时</span> : null}
        {row.details.length > 0 ? (
          <div className="balance-account-details">
            {row.details.slice(0, 2).map((detail) => (
              <span key={detail.label}>{detail.label} <b>{formatMoney(detail.value, detail.currency)}</b></span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="balance-account-cell">
        <span className="balance-cell-label">预警阈值</span>
        <strong>{row.lowBalance == null ? "未设置" : formatMoney(row.lowBalance, row.currency)}</strong>
      </div>
      <div className="balance-account-cell">
        <span className="balance-cell-label">最近成功</span>
        <strong title={formatDateTime(row.lastSuccessAt)}>{formatDateTime(row.lastSuccessAt)}</strong>
      </div>
      <div className="balance-account-cell">
        <span className="balance-cell-label">响应耗时</span>
        <strong>{row.checkedAt ? `${row.latencyMs.toLocaleString()} ms` : "—"}</strong>
      </div>
      <div className="balance-account-status">
        <i aria-hidden />
        <span>{meta.label}</span>
      </div>

      <div className="balance-account-message">
        <Activity aria-hidden size={13} />
        <span>{row.message || "等待下一次查询"}</span>
      </div>
    </article>
  );
}
