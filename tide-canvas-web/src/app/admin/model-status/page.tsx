"use client";

/* ============================================================================
   /admin/model-status — 模型状态.

   已上架模型的可用性看板（参考 ccgo 服务状态页的信息结构，视觉走后台
   苹果白语言）。数据源 GET /api/admin/models/status：internal/prober 定时
   探测的 model_probe 样本聚合——text 模型为真实流式补全（首字/完成时延），
   图片/视频/音频为上游目录可达性。

   - 默认「仅启用」；「全部」额外展示已下架但仍有探测历史的模型。
   - 卡片：状态点 / 时延块 / 24h·7天可用率条 / 最近 60 次检测条 / 下次倒计时。
   - 30s 自动刷新，倒计时本地每秒递减。
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AdminAlert, AdminEmptyState, FilterBar, Panel, TableSkeleton } from "@/components/admin";
import { adminSwatch } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminModelsApi } from "@/lib/admin-models-api";
import { resolveModelSwatch } from "@/lib/model-brand";
import { MODEL_TYPE_LABEL, type AdminModelStatusVO } from "@/types/admin-models";

const SCOPES: { label: string; scope: "enabled" | "all" }[] = [
  { label: "仅启用", scope: "enabled" },
  { label: "全部", scope: "all" },
];

const REFRESH_MS = 30_000;
const STRIP_LEN = 60;

function fmtMs(ms: number): string {
  return ms > 0 ? ms.toLocaleString("zh-CN") : "—";
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  // 100 显示整数，其余保留两位（对齐参考稿 99.66% 的精度）
  return v >= 100 ? "100%" : `${v.toFixed(2)}%`;
}

/** RFC3339/"YYYY-MM-DD HH:MM:SS" → "HH:MM"；解析失败退回正则截取。 */
function shortTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  }
  const m = /(\d{2}:\d{2}):\d{2}/.exec(s);
  return m ? m[1] : s;
}

/** 完整本地时间（strip 悬停与时间块 title 用）。 */
function fullTime(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("zh-CN", { hour12: false });
}

export default function AdminModelStatusPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<AdminModelStatusVO[]>([]);
  const [scopeIdx, setScopeIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 倒计时基准：本次数据抓取的时刻；tick 驱动每秒重算展示值。
  const [fetchedAt, setFetchedAt] = useState(0);
  const [, setTick] = useState(0);

  const reqIdRef = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      const id = ++reqIdRef.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const res = await adminModelsApi.status(SCOPES[scopeIdx].scope);
        if (id !== reqIdRef.current) return;
        if (res.success && res.data) {
          setRows(res.data);
          setFetchedAt(Date.now());
        } else {
          setError(res.message || "加载失败");
        }
      } catch {
        if (id !== reqIdRef.current) return;
        setError("加载失败，请稍后重试");
      } finally {
        if (id === reqIdRef.current) setLoading(false);
      }
    },
    [ensureSession, scopeIdx],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  // 静默轮询 + 每秒 tick（倒计时展示）。
  useEffect(() => {
    const poll = window.setInterval(() => void load(true), REFRESH_MS);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  const elapsedSec = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;

  const interval = useMemo(
    () => rows.find((r) => r.intervalSec > 0)?.intervalSec ?? 0,
    [rows],
  );
  const sub = loading
    ? "已上架模型的可用性与时延探测"
    : interval > 0
      ? `每 ${interval}s 自动探测 · 文本走真实补全，媒体走上游目录可达`
      : "探测已停用（配置管理 models.probeIntervalSec 设为正数即恢复）";

  return (
    <div className="adm-page mstat-page">
      <Panel
        title="模型状态"
        sub={sub}
        tools={
          <FilterBar
            options={SCOPES.map((s) => s.label)}
            value={SCOPES[scopeIdx].label}
            onChange={(_, i) => setScopeIdx(i)}
            actions={
              <button type="button" className="adm-btn ghost" onClick={() => void load()}>
                <RefreshCw aria-hidden size={14} />
                刷新
              </button>
            }
          />
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="模型状态加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={() => void load()}>
                  <RefreshCw aria-hidden size={14} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          </div>
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title="暂无可展示的模型"
            description="上架模型后探测器会自动开始检测；首轮数据最多等待一个探测周期。"
          />
        ) : (
          <div className="mstat-grid">
            {rows.map((m) => (
              <StatusCard key={m.id} m={m} elapsedSec={elapsedSec} />
            ))}
          </div>
        )}
      </Panel>

      <style>{`
        .mstat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
          padding: 16px;
        }
        .mstat-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .mstat-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .mstat-head .sw {
          flex: none;
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 700;
          overflow: hidden;
        }
        .mstat-head .nm {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          font-size: 15px;
          font-weight: 600;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mstat-head .nm .ty {
          margin-left: 8px;
          color: var(--text-faint);
          font-size: 11.5px;
          font-weight: 400;
        }
        .mstat-dot {
          display: inline-flex;
          flex: none;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .mstat-dot i { width: 7px; height: 7px; border-radius: 50%; }
        .mstat-dot.ok { color: var(--ok); }
        .mstat-dot.ok i { background: var(--ok); }
        .mstat-dot.bad { color: var(--danger); }
        .mstat-dot.bad i { background: var(--danger); }
        .mstat-dot.na { color: var(--text-faint); }
        .mstat-dot.na i { background: var(--text-faint); }
        .mstat-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .mstat-tile {
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--panel, rgba(0, 0, 0, 0.02));
        }
        .mstat-tile .k { color: var(--text-faint); font-size: 11.5px; }
        .mstat-tile .v { margin-top: 3px; font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; }
        .mstat-tile .v em { margin-left: 2px; color: var(--text-faint); font-size: 11.5px; font-style: normal; font-weight: 400; }
        .mstat-tile .s { margin-top: 2px; color: var(--text-faint); font-size: 11px; }
        .mstat-avail { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .mstat-avail .k { color: var(--text-faint); font-size: 11.5px; }
        .mstat-avail .v { margin: 3px 0 6px; font-size: 14.5px; font-weight: 650; font-variant-numeric: tabular-nums; }
        .mstat-bar { height: 4px; overflow: hidden; border-radius: 99px; background: var(--border); }
        .mstat-bar i { display: block; height: 100%; border-radius: 99px; background: var(--ok); }
        .mstat-strip-head {
          display: flex;
          justify-content: space-between;
          color: var(--text-faint);
          font-size: 11.5px;
        }
        .mstat-strip-head b { color: var(--text); font-weight: 600; }
        .mstat-strip { display: flex; gap: 2px; height: 22px; }
        .mstat-strip i { flex: 1; border-radius: 2px; background: var(--border); }
        .mstat-strip i.ok { background: var(--ok); }
        .mstat-strip i.bad { background: var(--danger); }
        .mstat-err {
          overflow: hidden;
          color: var(--danger);
          font-size: 11.5px;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      `}</style>
    </div>
  );
}

function StatusCard({ m, elapsedSec }: { m: AdminModelStatusVO; elapsedSec: number }) {
  const cur = m.current;
  const state: "ok" | "bad" | "na" = cur ? (cur.ok ? "ok" : "bad") : "na";
  const stateLabel = cur ? (cur.ok ? "可用" : "异常") : "待检测";
  const nextIn = m.intervalSec > 0 ? Math.max(m.nextInSec - elapsedSec, 0) : -1;

  const r = resolveModelSwatch({ name: m.name, modelKey: m.modelKey, icon: m.icon || undefined });
  const fallback = !!r.glyph;

  // 检测条：不足 60 格时左侧补空位，右端恒为最新。
  const pad = Math.max(STRIP_LEN - m.recent.length, 0);

  return (
    <div className="mstat-card">
      <div className="mstat-head">
        <span className="sw" style={fallback ? { background: adminSwatch(m.name) } : r.style}>
          {r.glyph}
        </span>
        <span className="nm">
          {m.name}
          <span className="ty">{MODEL_TYPE_LABEL[m.type] || m.type}{m.enabled ? "" : " · 已下架"}</span>
        </span>
        <span className={`mstat-dot ${state}`}>
          <i aria-hidden />
          {stateLabel}
        </span>
      </div>

      {m.kind === "chat" ? (
        <div className="mstat-tiles">
          <div className="mstat-tile">
            <div className="k">对话完成</div>
            <div className="v">
              {fmtMs(cur?.totalMs ?? 0)}
              <em>ms</em>
            </div>
            <div className="s">完整检测</div>
          </div>
          <div className="mstat-tile">
            <div className="k">首字响应</div>
            <div className="v">
              {fmtMs(cur?.firstMs ?? 0)}
              <em>ms</em>
            </div>
            <div className="s">流式探测</div>
          </div>
        </div>
      ) : (
        <div className="mstat-tiles">
          <div className="mstat-tile">
            <div className="k">当前状态</div>
            <div className="v" style={{ color: state === "ok" ? "var(--ok)" : state === "bad" ? "var(--danger)" : undefined }}>
              {stateLabel}
            </div>
            <div className="s">调度健康</div>
          </div>
          <div className="mstat-tile" title={cur ? fullTime(cur.time) : undefined}>
            <div className="k">最近检测</div>
            <div className="v">{cur ? shortTime(cur.time) : "—"}</div>
            <div className="s">目录可达 {fmtMs(cur?.totalMs ?? 0)} ms</div>
          </div>
        </div>
      )}

      <div className="mstat-avail">
        <div>
          <div className="k">24h 可用</div>
          <div className="v">{fmtPct(m.avail24h)}</div>
          <div className="mstat-bar">
            <i style={{ width: `${m.avail24h ?? 0}%` }} />
          </div>
        </div>
        <div>
          <div className="k">7 天可用</div>
          <div className="v">{fmtPct(m.avail7d)}</div>
          <div className="mstat-bar">
            <i style={{ width: `${m.avail7d ?? 0}%` }} />
          </div>
        </div>
      </div>

      <div>
        <div className="mstat-strip-head">
          <b>最近 {STRIP_LEN} 次检测</b>
          <span>{nextIn >= 0 ? `下次 ${nextIn}s` : "探测已停用"}</span>
        </div>
        <div
          className="mstat-strip"
          style={{ marginTop: 6 }}
          role="img"
          aria-label={`最近 ${m.recent.length} 次检测结果`}
        >
          {Array.from({ length: pad }, (_, i) => (
            <i key={`p${i}`} aria-hidden />
          ))}
          {m.recent.map((p, i) => (
            <i key={i} className={p.ok ? "ok" : "bad"} title={`${fullTime(p.time)} · ${p.ok ? "可用" : "异常"}${p.totalMs ? ` · ${p.totalMs}ms` : ""}`} />
          ))}
        </div>
      </div>

      {cur && !cur.ok && cur.error ? <div className="mstat-err">{cur.error}</div> : null}
    </div>
  );
}
