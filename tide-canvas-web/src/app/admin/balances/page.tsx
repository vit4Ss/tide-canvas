"use client";

/* ============================================================================
   /admin/balances — supplier balance monitor.

   Credentials remain in the Go service. This page polls the aggregate admin
   endpoint and presents current/last-known balances without ever calling a
   supplier from the browser.

   视觉语言：延续 admin「calm ops console」体系（发丝边、白面板、墨蓝点缀），
   用状态分布条、实时刷新倒计时、终端式日志条提供监控页应有的「活着」的感觉。
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
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
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  // 初始 null：SSR/水合首帧与服务端输出保持一致（倒计时文案确定），挂载后才开始走秒
  const [now, setNow] = useState<number | null>(null);
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
          setLastSyncAt(Date.now());
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

  // 刷新倒计时：每秒走一格，让「每 N 秒自动刷新」可见
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

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

  const elapsed = lastSyncAt == null || now == null ? 0 : Math.max(0, (now - lastSyncAt) / 1000);
  const remaining = Math.max(0, Math.ceil(refreshSeconds - elapsed));
  const syncProgress = Math.min(1, elapsed / refreshSeconds);

  return (
    <div className="adm-page balance-page">
      <header className="balance-page-head">
        <div>
          <h1>余额</h1>
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
        <div className="balance-hero">
          <span className="balance-hero-eyebrow">
            在线美元余额<em>TOTAL / USD</em>
          </span>
          <strong className="balance-hero-value">{liveUSD == null ? "—" : formatMoney(liveUSD, "USD")}</strong>
          <div
            className="balance-hero-meter"
            role="img"
            aria-label={`账户状态分布：健康 ${counts.healthy}、预警 ${counts.low}、异常 ${counts.errors}、未监控 ${counts.inactive}`}
          >
            {rows.map((row) => (
              <i
                key={row.key}
                className={`seg is-${row.state}`}
                title={`${row.name} · ${STATE_META[row.state]?.label ?? row.state}`}
              />
            ))}
            {rows.length === 0 ? <i className="seg" /> : null}
          </div>
          <small className="balance-hero-note">
            <b>{counts.connected}</b> / {rows.length || "—"} 个账户已连接
          </small>
        </div>

        <SummaryMetric label="健康账户" value={counts.healthy} tone="ok" />
        <SummaryMetric label="余额预警" value={counts.low} tone="warn" />
        <SummaryMetric label="查询异常" value={counts.errors} tone="danger" />
        <SummaryMetric label="未在监控" value={counts.inactive} tone="muted" />

        <div className="balance-sync">
          <span className="balance-sync-live"><i aria-hidden />实时监控</span>
          <div className="balance-sync-block">
            <span>最近同步</span>
            <strong>{formatDateTime(snapshot?.refreshedAt || "")}</strong>
          </div>
          <small className="balance-sync-next">
            {remaining > 0 ? `${remaining} 秒后自动刷新` : "即将刷新…"}
          </small>
          <span className="balance-sync-progress" aria-hidden>
            <i style={{ transform: `scaleX(${syncProgress})` }} />
          </span>
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
            <ShieldCheck aria-hidden size={14} />
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
        .balance-page { gap: 26px; }
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

        /* ---------- 概况带 ---------- */
        .balance-summary {
          display: grid;
          grid-template-columns: minmax(300px, 1.7fr) repeat(4, minmax(92px, .55fr)) minmax(200px, 1.05fr);
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--border-weak);
          box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 12px 28px -16px rgba(15, 23, 42, .12);
        }
        .balance-hero,
        .balance-metric,
        .balance-sync {
          min-width: 0;
          background: var(--surface);
        }

        .balance-hero { position: relative; padding: 22px 22px 18px; }
        .balance-hero::after {
          content: "";
          position: absolute;
          top: -40px;
          right: -50px;
          width: 180px;
          height: 180px;
          border-radius: 50%;
          background: radial-gradient(closest-side, rgba(59, 91, 219, .07), transparent);
          pointer-events: none;
        }
        .balance-hero-eyebrow {
          display: flex;
          align-items: baseline;
          gap: 10px;
          color: var(--text-faint);
          font-size: 12px;
        }
        .balance-hero-eyebrow em {
          font-family: var(--mono);
          font-size: 9px;
          font-style: normal;
          letter-spacing: .12em;
          opacity: .72;
        }
        .balance-hero-value {
          display: block;
          overflow: hidden;
          margin-top: 10px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 34px;
          font-weight: 650;
          letter-spacing: -.045em;
          line-height: 1.15;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-hero-meter {
          display: flex;
          gap: 4px;
          margin-top: 16px;
        }
        .balance-hero-meter .seg {
          height: 6px;
          min-width: 14px;
          flex: 1;
          border-radius: 99px;
          background: var(--border-strong);
        }
        .balance-hero-meter .seg.is-healthy { background: var(--ok); }
        .balance-hero-meter .seg.is-low { background: var(--warn); }
        .balance-hero-meter .seg.is-error { background: var(--danger); }
        .balance-hero-meter .seg.is-unconfigured,
        .balance-hero-meter .seg.is-disabled { opacity: .45; }
        .balance-hero-note {
          display: block;
          margin-top: 10px;
          color: var(--text-faint);
          font-size: 11px;
          white-space: nowrap;
        }
        .balance-hero-note b {
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 600;
        }

        .balance-metric {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 16px 18px;
        }
        .balance-metric-label {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--text-faint);
          font-size: 12px;
        }
        .balance-metric-label i {
          width: 6px;
          height: 6px;
          flex: none;
          border-radius: 50%;
          background: var(--border-strong);
        }
        .balance-metric-label i[data-tone="ok"] { background: var(--ok); }
        .balance-metric-label i[data-tone="warn"] { background: var(--warn); }
        .balance-metric-label i[data-tone="danger"] { background: var(--danger); }
        .balance-metric strong {
          margin-top: 9px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 22px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .balance-metric.is-warn .balance-metric-label,
        .balance-metric.is-warn strong { color: var(--warn-strong); }
        .balance-metric.is-danger .balance-metric-label,
        .balance-metric.is-danger strong { color: var(--danger-strong); }

        .balance-sync {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 10px;
          padding: 18px 18px 22px;
        }
        .balance-sync-live {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--ok-strong);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: .04em;
        }
        .balance-sync-live i {
          width: 7px;
          height: 7px;
          flex: none;
          border-radius: 50%;
          background: var(--ok);
          animation: balancePulse 2s var(--ease) infinite;
        }
        @keyframes balancePulse {
          0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, .38); }
          70% { box-shadow: 0 0 0 7px rgba(22, 163, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
        }
        .balance-sync-block span {
          display: block;
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-sync-block strong {
          display: block;
          overflow: hidden;
          margin-top: 4px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 12px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-sync-next {
          color: var(--text-faint);
          font-size: 11px;
          white-space: nowrap;
        }
        .balance-sync-progress {
          position: absolute;
          right: 0;
          bottom: 0;
          left: 0;
          height: 2px;
          background: var(--border-weak);
        }
        .balance-sync-progress i {
          display: block;
          height: 100%;
          background: var(--accent);
          transform-origin: left;
          transition: transform 1s linear;
        }

        /* ---------- 账户卡 ---------- */
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
          flex: none;
          align-items: center;
          gap: 7px;
          padding: 5px 11px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-ledger-security svg { color: var(--ok-strong); }

        .balance-account-board {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
          gap: 16px;
        }
        .balance-account {
          --account-state: var(--border-strong);
          --account-state-strong: var(--text-dim);
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 252px;
          flex-direction: column;
          padding: 21px 20px 20px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--surface);
          transition:
            transform var(--dur) var(--ease),
            border-color var(--dur) var(--ease),
            box-shadow var(--dur) var(--ease);
        }
        .balance-account:hover {
          transform: translateY(-2px);
          border-color: var(--border-strong);
          box-shadow: 0 2px 4px rgba(15, 23, 42, .04), 0 18px 36px -18px rgba(15, 23, 42, .18);
        }
        .balance-account::before {
          content: "";
          position: absolute;
          top: -1px;
          right: 22px;
          left: 22px;
          height: 2px;
          border-radius: 0 0 3px 3px;
          background: var(--account-state);
          opacity: 0;
        }
        .balance-account.is-healthy { --account-state: var(--ok); --account-state-strong: var(--ok-strong); }
        .balance-account.is-healthy::before,
        .balance-account.is-low::before,
        .balance-account.is-error::before { opacity: 1; }
        .balance-account.is-low {
          --account-state: var(--warn);
          --account-state-strong: var(--warn-strong);
          background: color-mix(in oklab, var(--warn-soft) 30%, var(--surface));
        }
        .balance-account.is-error {
          --account-state: var(--danger);
          --account-state-strong: var(--danger-strong);
          background: color-mix(in oklab, var(--danger-soft) 30%, var(--surface));
        }
        .balance-account-head {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 12px;
        }
        .balance-account-avatar {
          display: grid;
          width: 40px;
          height: 40px;
          flex: none;
          place-items: center;
          border: 1px solid color-mix(in oklab, var(--account-state) 28%, var(--border));
          border-radius: 10px;
          background: color-mix(in oklab, var(--account-state) 9%, var(--surface));
          color: var(--account-state-strong);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 650;
          letter-spacing: .04em;
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
          padding: 5px 10px;
          border: 1px solid color-mix(in oklab, var(--account-state) 24%, var(--border));
          border-radius: var(--r-sm);
          background: color-mix(in oklab, var(--account-state) 8%, var(--surface));
          color: var(--account-state-strong);
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
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--account-state) 16%, transparent);
        }
        .balance-account-main { padding: 24px 0 18px; }
        .balance-account-main > span {
          display: block;
          color: var(--text-dim);
          font-size: 11px;
        }
        .balance-account-value {
          overflow-wrap: anywhere;
          margin-top: 7px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 30px;
          font-weight: 650;
          letter-spacing: -.045em;
          line-height: 1.2;
          font-variant-numeric: tabular-nums;
        }
        .balance-account.is-low .balance-account-value { color: var(--warn-strong); }
        .balance-account.is-error .balance-account-value.is-empty { color: var(--danger-strong); }
        .balance-account-value.is-empty {
          color: var(--text-dim);
          font-family: var(--ui);
          font-size: 20px;
          font-weight: 550;
          letter-spacing: -.01em;
        }
        .balance-account-sub {
          min-height: 18px;
          margin-top: 7px;
          color: var(--text-dim);
          font-size: 11px;
        }
        .balance-account-sub b {
          margin-left: 6px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .balance-account-sub .is-stale {
          color: var(--warn-strong);
          font-weight: 600;
        }
        .balance-account-facts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          padding: 14px 0;
          border-top: 1px solid var(--border-weak);
        }
        .balance-account-fact { min-width: 0; }
        .balance-account-fact span {
          display: block;
          color: var(--text-dim);
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
          gap: 6px;
          padding-top: 12px;
        }
        .balance-account-detail {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border: 1px solid var(--border-weak);
          border-radius: 6px;
          background: var(--surface-2);
          color: var(--text-faint);
          font-size: 10.5px;
        }
        .balance-account-detail b {
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .balance-account-console {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: auto;
          padding: 9px 12px;
          border-radius: 8px;
          background: #141419;
          color: #9c9ca6;
          font-family: var(--mono);
          font-size: 10.5px;
          line-height: 1.5;
        }
        .balance-account-console i {
          width: 6px;
          height: 6px;
          flex: none;
          border-radius: 50%;
          background: var(--account-state);
        }
        .balance-account-console span { overflow-wrap: anywhere; }

        /* ---------- 骨架屏 ---------- */
        .balance-account-skeleton { min-height: 252px; }
        .balance-account-skeleton:hover { transform: none; box-shadow: none; border-color: var(--border); }
        .balance-skeleton-head { display: flex; align-items: center; gap: 12px; }
        .balance-skeleton-avatar { width: 40px; height: 40px; border-radius: 10px; }
        .balance-skeleton-copy { display: flex; flex-direction: column; gap: 8px; }
        .balance-skeleton-name { width: 88px; height: 12px; }
        .balance-skeleton-source { width: 116px; height: 9px; }
        .balance-skeleton-status { width: 74px; height: 24px; margin-left: auto; border-radius: var(--r-sm); }
        .balance-skeleton-value { width: 164px; height: 26px; margin-top: 28px; }
        .balance-skeleton-sub { width: 124px; height: 10px; margin-top: 10px; }
        .balance-skeleton-facts {
          display: flex;
          gap: 16px;
          margin-top: 24px;
          padding-top: 14px;
          border-top: 1px solid var(--border-weak);
        }
        .balance-skeleton-fact { width: 112px; height: 10px; }
        .balance-skeleton-message { width: 100%; height: 28px; margin-top: auto; border-radius: 8px; }
        .balance-empty {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--surface);
        }
        .balance-spin { animation: balanceSpin .8s linear infinite; }
        @keyframes balanceSpin { to { transform: rotate(360deg); } }

        @media (max-width: 1240px) {
          .balance-summary { grid-template-columns: minmax(260px, 1.5fr) repeat(4, minmax(84px, .6fr)); }
          .balance-sync { grid-column: 1 / -1; }
        }
        @media (max-width: 820px) {
          .balance-page-head { flex-direction: column; }
          .balance-refresh { width: 100%; min-height: 44px; }
          .balance-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .balance-hero,
          .balance-sync { grid-column: 1 / -1; }
        }
        @media (max-width: 560px) {
          .balance-page { gap: 20px; }
          .balance-page-head h1 { font-size: 22px; }
          .balance-ledger-head { align-items: flex-start; flex-direction: column; }
          .balance-account { min-height: 0; padding: 18px 16px 16px; }
          .balance-account-main { padding-top: 20px; }
          .balance-account-value { font-size: 26px; }
          .balance-hero-value { font-size: 28px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .balance-spin,
          .balance-sync-live i { animation: none; }
          .balance-account,
          .balance-sync-progress i { transition: none; }
          .balance-account:hover { transform: none; }
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
  tone: "ok" | "warn" | "danger" | "muted";
}) {
  const emphasized = (tone === "warn" || tone === "danger") && value > 0;
  return (
    <div className={`balance-metric${emphasized ? ` is-${tone}` : ""}`}>
      <span className="balance-metric-label">
        <i data-tone={tone} aria-hidden />
        {label}
      </span>
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

      <div className="balance-account-console">
        <i aria-hidden />
        <span>{row.message || "等待下一次查询"}</span>
      </div>
    </article>
  );
}
