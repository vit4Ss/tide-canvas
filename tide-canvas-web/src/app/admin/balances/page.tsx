"use client";

/* ============================================================================
   /admin/balances — supplier balance monitor.

   Credentials remain in the Go service. This page polls the aggregate admin
   endpoint and presents current/last-known balances without ever calling a
   supplier from the browser.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  TableSkeleton,
} from "@/components/admin";
import { adminBalancesApi } from "@/lib/admin-balances-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type {
  SupplierBalancesVO,
  SupplierBalanceState,
  SupplierBalanceVO,
} from "@/types/admin-balances";

const DEFAULT_REFRESH_SECONDS = 30;

const STATE_META: Record<SupplierBalanceState, { label: string; code: string }> = {
  healthy: { label: "运行正常", code: "ONLINE" },
  low: { label: "余额预警", code: "LOW" },
  error: { label: "查询异常", code: "ERROR" },
  unconfigured: { label: "等待接入", code: "PENDING" },
  disabled: { label: "监控停用", code: "OFFLINE" },
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
            <span className="balance-eyebrow">
              <i aria-hidden />
              LIVE TREASURY CONTROL
            </span>
            <h1 id="balance-title">供应商资金监控</h1>
            <p>集中观察上游账户余额、额度健康度与认证状态，异常账户不会阻塞其他供应商。</p>
          </div>
          <button
            type="button"
            className="balance-refresh"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden size={15} className={refreshing ? "balance-spin" : undefined} />
            {refreshing ? "同步中" : "立即同步"}
          </button>
        </div>

        <div className="balance-command-grid" aria-label="资金监控概况">
          <div className="balance-total">
            <div className="balance-total-icon" aria-hidden><WalletCards size={19} /></div>
            <div>
              <span>在线美元余额</span>
              <strong>{liveUSD == null ? "—" : formatMoney(liveUSD, "USD")}</strong>
              <small>{counts.connected} / {rows.length || "—"} 个账户已连接</small>
            </div>
          </div>
          <CommandMetric label="健康账户" value={counts.healthy} tone="ok" />
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
            <span>ACCOUNT MATRIX</span>
            <h2 id="balance-ledger-title">供应商账户</h2>
          </div>
          <div className="balance-ledger-security">
            <ShieldCheck aria-hidden size={15} />
            凭据仅由服务端读取
          </div>
        </header>

        {loading && !snapshot ? (
          <div className="balance-loading"><TableSkeleton rows={4} cols={4} /></div>
        ) : error && !snapshot ? null : rows.length === 0 ? (
          <div className="balance-empty">
            <AdminEmptyState
              title="暂无供应商"
              description="请先在后台配置管理的「供应商余额」分组中启用并填写访问令牌。"
            />
          </div>
        ) : (
          <div className="balance-card-grid">
            {rows.map((row) => <SupplierBalanceCard key={row.key} row={row} />)}
          </div>
        )}
      </section>

      <style>{`
        .balance-page { gap: 18px; }
        .balance-command {
          position: relative;
          overflow: hidden;
          padding: 26px;
          border: 1px solid #292d39;
          border-top: 3px solid #7891ff;
          border-radius: 16px;
          background: #171922;
          color: #f7f8fc;
          box-shadow: 0 18px 44px rgba(20, 22, 31, .14);
        }
        .balance-command-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 28px;
        }
        .balance-command-copy { max-width: 700px; }
        .balance-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #aeb7d0;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: .16em;
        }
        .balance-eyebrow i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 0 4px rgba(74, 222, 128, .12);
        }
        .balance-command h1 {
          margin: 12px 0 7px;
          color: #fff;
          font-size: 26px;
          font-weight: 650;
          letter-spacing: -.035em;
          line-height: 1.2;
        }
        .balance-command-copy p {
          margin: 0;
          color: #9fa7ba;
          font-size: 13px;
          line-height: 1.7;
        }
        .balance-refresh {
          display: flex;
          height: 38px;
          flex: none;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 0 14px;
          border: 1px solid #f4f5f8;
          border-radius: 9px;
          background: #f4f5f8;
          color: #171922;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: transform .15s var(--ease), background .15s var(--ease);
        }
        .balance-refresh:hover { background: #fff; transform: translateY(-1px); }
        .balance-refresh:disabled { opacity: .6; cursor: not-allowed; transform: none; }
        .balance-command-grid {
          display: grid;
          grid-template-columns: minmax(250px, 1.7fr) repeat(4, minmax(92px, .62fr)) minmax(160px, 1fr);
          margin-top: 24px;
          border: 1px solid #303441;
          border-radius: 12px;
          background: #1d202a;
        }
        .balance-total {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 13px;
          padding: 18px 20px;
          border-right: 1px solid #303441;
        }
        .balance-total-icon {
          display: grid;
          width: 42px;
          height: 42px;
          flex: none;
          place-items: center;
          border: 1px solid #3b4050;
          border-radius: 10px;
          background: #252936;
          color: #95a8ff;
        }
        .balance-total span,
        .balance-command-metric span,
        .balance-sync-time span {
          display: block;
          color: #8f97aa;
          font-size: 10px;
          letter-spacing: .08em;
        }
        .balance-total strong {
          display: block;
          overflow: hidden;
          margin-top: 4px;
          color: #fff;
          font-family: var(--mono);
          font-size: 23px;
          font-weight: 600;
          letter-spacing: -.04em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-total small,
        .balance-sync-time small {
          display: block;
          margin-top: 5px;
          color: #767f93;
          font-size: 10px;
          white-space: nowrap;
        }
        .balance-command-metric {
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 17px 16px;
          border-right: 1px solid #303441;
        }
        .balance-command-metric strong {
          margin-top: 6px;
          color: #f7f8fc;
          font-family: var(--mono);
          font-size: 21px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .balance-command-metric.is-ok strong { color: #4ade80; }
        .balance-command-metric.is-warn strong { color: #fbbf24; }
        .balance-command-metric.is-danger strong { color: #fb7185; }
        .balance-sync-time {
          position: relative;
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 17px 18px 17px 41px;
        }
        .balance-sync-time > svg {
          position: absolute;
          top: 19px;
          left: 18px;
          color: #7f8ba6;
        }
        .balance-sync-time strong {
          overflow: hidden;
          margin-top: 6px;
          color: #dfe3ed;
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-ledger {
          padding: 22px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: #f0f1f4;
        }
        .balance-ledger-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 17px;
          padding: 0 2px;
        }
        .balance-ledger-head span {
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: .16em;
        }
        .balance-ledger-head h2 {
          margin: 5px 0 0;
          color: var(--text-title);
          font-size: 18px;
          font-weight: 650;
          letter-spacing: -.02em;
        }
        .balance-ledger-security {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--text-faint);
          font-size: 11px;
        }
        .balance-ledger-security svg { color: var(--ok); }
        .balance-card-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }
        .balance-card {
          --card-state: #a1a1aa;
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 285px;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid #dddfe5;
          border-top: 3px solid var(--card-state);
          border-radius: 13px;
          background: var(--surface);
          box-shadow: 0 8px 24px rgba(25, 28, 38, .06);
          transition: transform .18s var(--ease), box-shadow .18s var(--ease), border-color .18s var(--ease);
        }
        .balance-card:hover {
          transform: translateY(-2px);
          border-color: #cfd2da;
          box-shadow: 0 14px 32px rgba(25, 28, 38, .09);
        }
        .balance-card.is-healthy { --card-state: #22a35a; }
        .balance-card.is-low { --card-state: #e59a19; }
        .balance-card.is-error { --card-state: #df4b5f; }
        .balance-card.is-disabled,
        .balance-card.is-unconfigured { --card-state: #a4a8b2; background: #fbfbfc; }
        .balance-card-head {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 16px 17px 0;
        }
        .balance-card-avatar {
          display: grid;
          width: 40px;
          height: 40px;
          flex: none;
          place-items: center;
          border-radius: 10px;
          background: #1c1f29;
          color: #f7f8fc;
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .04em;
        }
        .balance-card-provider { min-width: 0; }
        .balance-card-provider strong {
          display: block;
          overflow: hidden;
          color: var(--text-title);
          font-size: 14px;
          font-weight: 650;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-card-provider small {
          display: block;
          overflow: hidden;
          margin-top: 3px;
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 9.5px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-card-status {
          display: flex;
          margin-left: auto;
          flex: none;
          align-items: center;
          gap: 7px;
          padding: 6px 8px;
          border: 1px solid #e5e6ea;
          border-radius: 7px;
          background: #fafafb;
        }
        .balance-card-status i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--card-state);
        }
        .balance-card-status span { color: var(--text-dim); font-size: 10.5px; font-weight: 600; }
        .balance-card-status small {
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 8px;
          letter-spacing: .06em;
        }
        .balance-card-main { padding: 24px 17px 18px; }
        .balance-card-main > span {
          color: var(--text-faint);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .06em;
        }
        .balance-card-value {
          margin-top: 6px;
          color: var(--text-title);
          font-family: var(--mono);
          font-size: 28px;
          font-weight: 620;
          letter-spacing: -.055em;
          line-height: 1.15;
          font-variant-numeric: tabular-nums;
        }
        .balance-card.is-low .balance-card-value { color: #b86f06; }
        .balance-card-value.is-empty { color: #9a9da7; font-family: var(--ui); font-size: 22px; letter-spacing: -.02em; }
        .balance-card-sub {
          display: flex;
          min-height: 18px;
          align-items: center;
          gap: 7px;
          margin-top: 8px;
          color: var(--text-faint);
          font-size: 10.5px;
        }
        .balance-card-sub b { color: var(--text-dim); font-family: var(--mono); font-weight: 500; }
        .balance-card-sub .is-stale { color: var(--warn); font-weight: 600; }
        .balance-card-facts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px;
          margin: 0 17px 16px;
          overflow: hidden;
          border: 1px solid var(--border-weak);
          border-radius: 9px;
          background: var(--border-weak);
        }
        .balance-card-fact {
          min-width: 0;
          padding: 10px 11px;
          background: #fafafb;
        }
        .balance-card-fact span { display: block; color: var(--text-faint); font-size: 9.5px; }
        .balance-card-fact strong {
          display: block;
          overflow: hidden;
          margin-top: 4px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 550;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-card-details {
          display: flex;
          gap: 14px;
          margin: -4px 17px 15px;
          padding-top: 11px;
          border-top: 1px solid var(--border-weak);
        }
        .balance-card-detail { min-width: 0; }
        .balance-card-detail span { display: block; color: var(--text-faint); font-size: 9px; }
        .balance-card-detail strong {
          display: block;
          overflow: hidden;
          margin-top: 3px;
          color: var(--text-dim);
          font-family: var(--mono);
          font-size: 10.5px;
          font-weight: 550;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-card-foot {
          display: flex;
          min-height: 42px;
          margin-top: auto;
          align-items: center;
          gap: 8px;
          padding: 10px 17px;
          border-top: 1px solid var(--border-weak);
          background: #fafafb;
          color: var(--text-faint);
          font-size: 10.5px;
        }
        .balance-card-foot svg { flex: none; color: var(--card-state); }
        .balance-card-foot span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance-loading,
        .balance-empty {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
        }
        .balance-spin { animation: balanceSpin .8s linear infinite; }
        @keyframes balanceSpin { to { transform: rotate(360deg); } }
        @media (max-width: 1240px) {
          .balance-command-grid { grid-template-columns: minmax(240px, 1.5fr) repeat(4, minmax(82px, .6fr)); }
          .balance-sync-time { grid-column: 1 / -1; min-height: 60px; border-top: 1px solid #303441; }
          .balance-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 820px) {
          .balance-command { padding: 20px; }
          .balance-command-top { flex-direction: column; }
          .balance-refresh { width: 100%; }
          .balance-command-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .balance-total { grid-column: 1 / -1; border-right: 0; border-bottom: 1px solid #303441; }
          .balance-command-metric:nth-of-type(odd) { border-right: 0; }
          .balance-sync-time { grid-column: 1 / -1; }
          .balance-card-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .balance-command h1 { font-size: 23px; }
          .balance-ledger { padding: 16px; }
          .balance-ledger-head { align-items: flex-start; flex-direction: column; }
          .balance-card-status small { display: none; }
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
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className={`balance-command-metric${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("zh-CN").padStart(2, "0")}</strong>
    </div>
  );
}

function SupplierBalanceCard({ row }: { row: SupplierBalanceVO }) {
  const meta = STATE_META[row.state] ?? STATE_META.error;
  const connected = row.balance != null;
  const emptyBalanceLabel = row.state === "error"
    ? "查询失败"
    : row.state === "disabled"
      ? "监控已停用"
      : "尚未接入";

  return (
    <article className={`balance-card is-${row.state}`}>
      <header className="balance-card-head">
        <span className="balance-card-avatar" aria-hidden>{supplierInitial(row.name)}</span>
        <div className="balance-card-provider">
          <strong>{row.name}</strong>
          <small>{row.source || "NO ENDPOINT"}</small>
        </div>
        <div className="balance-card-status" title={row.message}>
          <i aria-hidden />
          <span>{meta.label}</span>
          <small>{meta.code}</small>
        </div>
      </header>

      <div className="balance-card-main">
        <span>AVAILABLE BALANCE</span>
        <div className={`balance-card-value${connected ? "" : " is-empty"}`}>
          {connected ? formatMoney(row.balance, row.currency) : emptyBalanceLabel}
        </div>
        <div className="balance-card-sub">
          {row.stale ? <span className="is-stale">最近成功值 · 非实时</span> : (
            <>
              <span>预警阈值</span>
              <b>{row.lowBalance == null ? "未设置" : formatMoney(row.lowBalance, row.currency)}</b>
            </>
          )}
        </div>
      </div>

      <div className="balance-card-facts">
        <div className="balance-card-fact">
          <span>最近成功</span>
          <strong>{formatDateTime(row.lastSuccessAt)}</strong>
        </div>
        <div className="balance-card-fact">
          <span>响应耗时</span>
          <strong>{row.checkedAt ? `${row.latencyMs.toLocaleString()} ms` : "—"}</strong>
        </div>
      </div>

      {row.details.length > 0 ? (
        <div className="balance-card-details">
          {row.details.slice(0, 2).map((detail) => (
            <div className="balance-card-detail" key={detail.label}>
              <span>{detail.label}</span>
              <strong>{formatMoney(detail.value, detail.currency)}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="balance-card-foot">
        <Activity aria-hidden size={13} />
        <span title={row.message}>{row.message || "等待下一次查询"}</span>
      </footer>
    </article>
  );
}
