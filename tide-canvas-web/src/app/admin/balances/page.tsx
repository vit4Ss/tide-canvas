"use client";

/* ============================================================================
   /admin/balances — supplier balance monitor.

   Credentials remain in the Go service. This page polls the aggregate admin
   endpoint and presents current/last-known balances without ever calling a
   supplier from the browser.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { AdminAlert, AdminEmptyState } from "@/components/admin";
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
      <header className="balance-page-head">
        <div>
          <h1>供应商余额</h1>
          <p>查看上游账户余额与认证状态，异常账户不会影响其他供应商查询。</p>
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
      </header>

      <section className="balance-summary" aria-label="资金监控概况">
        <div className="balance-summary-primary">
          <span>在线美元余额</span>
          <strong>{liveUSD == null ? "—" : formatMoney(liveUSD, "USD")}</strong>
          <small>{counts.connected} / {rows.length || "—"} 个账户已连接</small>
        </div>
        <SummaryMetric label="健康账户" value={counts.healthy} />
        <SummaryMetric label="余额预警" value={counts.low} tone="warn" />
        <SummaryMetric label="查询异常" value={counts.errors} tone="danger" />
        <SummaryMetric label="未在监控" value={counts.inactive} />
        <div className="balance-summary-sync">
          <Clock3 aria-hidden size={14} />
          <div>
            <span>最近同步</span>
            <strong>{formatDateTime(snapshot?.refreshedAt || "")}</strong>
            <small>每 {refreshSeconds} 秒自动刷新</small>
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
          <BalanceBoardSkeleton />
        ) : error && !snapshot ? null : rows.length === 0 ? (
          <div className="balance-empty">
            <AdminEmptyState
              title="暂无供应商"
              description="请先在后台配置管理的「供应商余额」分组中启用并填写访问令牌。"
            />
          </div>
        ) : (
          <div className="balance-account-board">
            {rows.map((row) => <SupplierBalanceAccount key={row.key} row={row} />)}
          </div>
        )}
      </section>

      <style>{`
        .balance-page { gap: 24px; }
        .balance-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding-top: 4px;
        }
        .balance-page-head h1 {
          margin: 0;
          color: var(--text-title);
          font-size: 24px;
          font-weight: 650;
          letter-spacing: -.025em;
          line-height: 1.3;
          text-wrap: balance;
        }
        .balance-page-head p {
          max-width: 68ch;
          margin: 8px 0 0;
          color: var(--text-faint);
          font-size: 13px;
          line-height: 1.6;
          text-wrap: pretty;
        }
        .balance-refresh { min-width: 112px; flex: none; }

        .balance-summary {
          display: grid;
          grid-template-columns: minmax(240px, 1.6fr) repeat(4, minmax(88px, .58fr)) minmax(176px, 1fr);
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--border-weak);
        }
        .balance-summary-primary,
        .balance-summary-metric,
        .balance-summary-sync {
          min-width: 0;
          background: var(--surface);
        }
        .balance-summary-primary { padding: 20px; }
        .balance-summary-primary span,
        .balance-summary-metric span,
        .balance-summary-sync span {
          display: block;
          color: var(--text-faint);
          font-size: 12px;
          font-weight: 400;
        }
        .balance-summary-primary strong {
          display: block;
          overflow: hidden;
          margin-top: 8px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 24px;
          font-weight: 650;
          letter-spacing: -.03em;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-summary-primary small,
        .balance-summary-sync small {
          display: block;
          margin-top: 5px;
          color: var(--text-faint);
          font-size: 11px;
          white-space: nowrap;
        }
        .balance-summary-metric {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 16px;
        }
        .balance-summary-metric strong {
          margin-top: 8px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 20px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .balance-summary-metric.is-warn span,
        .balance-summary-metric.is-warn strong { color: var(--warn-strong); }
        .balance-summary-metric.is-danger span,
        .balance-summary-metric.is-danger strong { color: var(--danger-strong); }
        .balance-summary-sync {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 18px 16px;
        }
        .balance-summary-sync > svg {
          flex: none;
          margin-top: 1px;
          color: var(--text-faint);
        }
        .balance-summary-sync strong {
          display: block;
          overflow: hidden;
          margin-top: 7px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 11.5px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .balance-ledger { min-width: 0; }
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
        .balance-ledger-security svg { color: var(--ok-strong); }

        .balance-account-board {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--border-weak);
        }
        .balance-account {
          --account-state: var(--text-faint);
          --account-status-bg: var(--surface-2);
          --account-status-border: var(--border);
          --account-status-text: var(--text-dim);
          display: flex;
          min-width: 0;
          min-height: 252px;
          flex-direction: column;
          padding: 20px;
          background: var(--surface);
        }
        .balance-account:last-child:nth-child(odd) { grid-column: 1 / -1; }
        .balance-account.is-healthy {
          --account-state: var(--ok);
          --account-status-bg: var(--ok-soft);
          --account-status-border: color-mix(in oklab, var(--ok) 24%, var(--border));
          --account-status-text: var(--ok-strong);
        }
        .balance-account.is-low {
          --account-state: var(--warn);
          --account-status-bg: var(--warn-soft);
          --account-status-border: color-mix(in oklab, var(--warn) 30%, var(--border));
          --account-status-text: var(--warn-strong);
          background: color-mix(in oklab, var(--warn-soft) 34%, var(--surface));
        }
        .balance-account.is-error {
          --account-state: var(--danger);
          --account-status-bg: var(--danger-soft);
          --account-status-border: color-mix(in oklab, var(--danger) 26%, var(--border));
          --account-status-text: var(--danger-strong);
          background: color-mix(in oklab, var(--danger-soft) 34%, var(--surface));
        }
        .balance-account-head {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 12px;
        }
        .balance-account-avatar {
          display: grid;
          width: 38px;
          height: 38px;
          flex: none;
          place-items: center;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--surface-2);
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 650;
        }
        .balance-account-provider { min-width: 0; }
        .balance-account-provider strong,
        .balance-account-provider small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-account-provider strong {
          color: var(--text-title);
          font-size: 14px;
          font-weight: 600;
        }
        .balance-account-provider small {
          margin-top: 4px;
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 10px;
        }
        .balance-account-status {
          display: inline-flex;
          width: fit-content;
          margin-left: auto;
          align-items: center;
          gap: 7px;
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
        .balance-account-main { padding: 24px 0 18px; }
        .balance-account-main > span {
          display: block;
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-account-value {
          overflow-wrap: anywhere;
          margin-top: 7px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 28px;
          font-weight: 650;
          letter-spacing: -.04em;
          line-height: 1.2;
          font-variant-numeric: tabular-nums;
        }
        .balance-account.is-low .balance-account-value { color: var(--warn-strong); }
        .balance-account.is-error .balance-account-value.is-empty { color: var(--danger-strong); }
        .balance-account-value.is-empty {
          color: var(--text-dim);
          font-family: var(--ui);
          font-size: 20px;
          letter-spacing: -.01em;
        }
        .balance-account-sub {
          min-height: 18px;
          margin-top: 7px;
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-account-sub b {
          margin-left: 6px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .balance-account-sub .is-stale { color: var(--warn-strong); font-weight: 600; }
        .balance-account-facts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          padding: 14px 0;
          border-top: 1px solid var(--border-weak);
          border-bottom: 1px solid var(--border-weak);
        }
        .balance-account-fact { min-width: 0; }
        .balance-account-fact span {
          display: block;
          color: var(--text-faint);
          font-size: 10px;
        }
        .balance-account-fact strong {
          display: block;
          overflow: hidden;
          margin-top: 5px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-account-details {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 18px;
          padding-top: 12px;
        }
        .balance-account-detail {
          color: var(--text-faint);
          font-size: 10.5px;
        }
        .balance-account-detail b {
          margin-left: 5px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .balance-account-message {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-top: auto;
          padding-top: 14px;
          color: var(--text-dim);
          font-size: 11px;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }
        .balance-account-message svg {
          flex: none;
          margin-top: 2px;
          color: var(--account-state);
        }
        .balance-account.is-low .balance-account-message,
        .balance-account.is-error .balance-account-message { color: var(--account-status-text); }

        .balance-account-skeleton { min-height: 252px; }
        .balance-skeleton-head { display: flex; align-items: center; gap: 12px; }
        .balance-skeleton-avatar { width: 38px; height: 38px; border-radius: var(--r); }
        .balance-skeleton-copy { display: flex; flex-direction: column; gap: 8px; }
        .balance-skeleton-name { width: 88px; height: 12px; }
        .balance-skeleton-source { width: 116px; height: 9px; }
        .balance-skeleton-status { width: 74px; height: 24px; margin-left: auto; border-radius: var(--r-sm); }
        .balance-skeleton-value { width: 164px; height: 24px; margin-top: 28px; }
        .balance-skeleton-sub { width: 124px; height: 10px; margin-top: 10px; }
        .balance-skeleton-facts {
          display: flex;
          gap: 16px;
          margin-top: 24px;
          padding-top: 14px;
          border-top: 1px solid var(--border-weak);
        }
        .balance-skeleton-fact { width: 112px; height: 10px; }
        .balance-skeleton-message { width: min(320px, 76%); height: 10px; margin-top: auto; }
        .balance-empty {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .balance-spin { animation: balanceSpin .8s linear infinite; }
        @keyframes balanceSpin { to { transform: rotate(360deg); } }

        @media (max-width: 1240px) {
          .balance-summary { grid-template-columns: minmax(232px, 1.5fr) repeat(4, minmax(80px, .6fr)); }
          .balance-summary-sync { grid-column: 1 / -1; }
        }
        @media (max-width: 820px) {
          .balance-page-head { flex-direction: column; }
          .balance-refresh { width: 100%; min-height: 44px; }
          .balance-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .balance-summary-primary,
          .balance-summary-sync { grid-column: 1 / -1; }
          .balance-account-board { grid-template-columns: 1fr; }
          .balance-account:last-child:nth-child(odd) { grid-column: auto; }
        }
        @media (max-width: 560px) {
          .balance-page { gap: 20px; }
          .balance-page-head h1 { font-size: 22px; }
          .balance-ledger-head { align-items: flex-start; flex-direction: column; }
          .balance-ledger-security { font-size: 11px; }
          .balance-account { min-height: 0; padding: 16px; }
          .balance-account-main { padding-top: 20px; }
          .balance-account-value { font-size: 24px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .balance-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}

function SummaryMetric({
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
    <div className={`balance-summary-metric${emphasized ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("zh-CN").padStart(2, "0")}</strong>
    </div>
  );
}

function BalanceBoardSkeleton() {
  return (
    <div className="balance-account-board" aria-busy="true">
      <span className="sr-only" role="status">正在加载供应商余额</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div className="balance-account balance-account-skeleton" aria-hidden key={index}>
          <div className="balance-skeleton-head">
            <span className="skel balance-skeleton-avatar" />
            <span className="balance-skeleton-copy">
              <span className="skel balance-skeleton-name" />
              <span className="skel balance-skeleton-source" />
            </span>
            <span className="skel balance-skeleton-status" />
          </div>
          <span className="skel balance-skeleton-value" />
          <span className="skel balance-skeleton-sub" />
          <span className="balance-skeleton-facts">
            <span className="skel balance-skeleton-fact" />
            <span className="skel balance-skeleton-fact" />
          </span>
          <span className="skel balance-skeleton-message" />
        </div>
      ))}
    </div>
  );
}

function SupplierBalanceAccount({ row }: { row: SupplierBalanceVO }) {
  const meta = STATE_META[row.state] ?? STATE_META.error;
  const connected = row.balance != null;
  const emptyBalanceLabel = row.state === "error"
    ? "查询失败"
    : row.state === "disabled"
      ? "监控已停用"
      : "尚未接入";

  return (
    <article className={`balance-account is-${row.state}`} aria-label={`${row.name}：${meta.label}`}>
      <header className="balance-account-head">
        <span className="balance-account-avatar" aria-hidden>{supplierInitial(row.name)}</span>
        <div className="balance-account-provider">
          <strong>{row.name}</strong>
          <small title={row.source}>{row.source || "未配置地址"}</small>
        </div>
        <div className="balance-account-status">
          <i aria-hidden />
          <span>{meta.label}</span>
        </div>
      </header>

      <div className="balance-account-main">
        <span>可用余额</span>
        <div className={`balance-account-value${connected ? "" : " is-empty"}`}>
          {connected ? formatMoney(row.balance, row.currency) : emptyBalanceLabel}
        </div>
        <div className="balance-account-sub">
          {row.stale ? <span className="is-stale">最近成功值 · 非实时</span> : (
            <>
              <span>预警阈值</span>
              <b>{row.lowBalance == null ? "未设置" : formatMoney(row.lowBalance, row.currency)}</b>
            </>
          )}
        </div>
      </div>

      <div className="balance-account-facts">
        <div className="balance-account-fact">
          <span>最近成功</span>
          <strong title={formatDateTime(row.lastSuccessAt)}>{formatDateTime(row.lastSuccessAt)}</strong>
        </div>
        <div className="balance-account-fact">
          <span>响应耗时</span>
          <strong>{row.checkedAt ? `${row.latencyMs.toLocaleString()} ms` : "—"}</strong>
        </div>
      </div>

      {row.details.length > 0 ? (
        <div className="balance-account-details">
          {row.details.slice(0, 2).map((detail) => (
            <span className="balance-account-detail" key={detail.label}>
              {detail.label}<b>{formatMoney(detail.value, detail.currency)}</b>
            </span>
          ))}
        </div>
      ) : null}

      <footer className="balance-account-message">
        <Activity aria-hidden size={13} />
        <span>{row.message || "等待下一次查询"}</span>
      </footer>
    </article>
  );
}
