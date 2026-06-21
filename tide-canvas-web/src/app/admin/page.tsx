"use client";

/* ============================================================================
   /admin — 数据概览 (dashboard), wired to the REAL backend.

   Faithful port of the liuguang admin.js V.dash() skin, now driven by:
     GET /api/admin/dashboard/stats  -> AdminStatsVO  (KPI cards + hero)
     GET /api/admin/dashboard/charts -> AdminChartsVO (recharts trends)

   Only the data the backend exposes is rendered:
     - hero strip: 今日实时营收 (totalRevenue head metric + today) + inline stats
       (总订单 / 已支付 / 付费用户) + a revenue sparkline.
     - 8 KPI cards: totalUsers / todayNewUsers / activeUsers / payingUsers /
       totalPosts / totalModels / totalOrders / paidOrders.
     - 增长趋势 (area): switchable user / post / order / revenue series.
     - 用户 vs 内容增长 (multi-line): userGrowth & postGrowth over 14 days.
     - 订单 / 营收 (area).

   Keeps the EXACT liuguang `.viz-*` markup/classes + the shared AreaTrend /
   MultiLine / StatCardGrid components. Loading + empty states included. No
   @/mock imports. Client component (charts + interactive series toggle).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaTrend, MultiLine } from "@/components/admin/charts";
import { StatCardGrid } from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminDashboardApi } from "@/lib/admin-dashboard-api";
import type {
  AdminChartsVO,
  AdminStatsVO,
  ChartPoint,
  RevenuePoint,
} from "@/types/admin-dashboard";

/** Build a tiny svg sparkline `d` for the hero strip (smooth, no axes). */
function sparkPath(vals: number[], w = 200, h = 32, pad = 3): string {
  if (vals.length === 0) return "";
  const max = Math.max(...vals) * 1.12 || 1;
  const min = Math.min(...vals) * 0.9;
  const span = max - min || 1;
  const denom = vals.length > 1 ? vals.length - 1 : 1;
  const xs = (i: number) => pad + (i / denom) * (w - pad * 2);
  const ys = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  let d = `M ${xs(0)} ${ys(vals[0])}`;
  for (let i = 1; i < vals.length; i++) {
    const x0 = xs(i - 1);
    const y0 = ys(vals[i - 1]);
    const x1 = xs(i);
    const y1 = ys(vals[i]);
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

/** "YYYY-MM-DD" -> "MM-DD" for compact axis labels. */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5) : d;
}

/** Format an integer with thousands separators. */
const fmtNum = (n: number) => n.toLocaleString("zh-Hans-CN");

/** Format a fixed-2 decimal string ("0.00") as ¥ currency. */
function fmtMoney(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? `¥${n.toLocaleString("zh-Hans-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `¥${s}`;
}

type SeriesKey = "user" | "post" | "order" | "revenue";

const SERIES_META: { key: SeriesKey; label: string; color: string }[] = [
  { key: "user", label: "用户增长", color: "#0a84ff" },
  { key: "post", label: "作品增长", color: "#bf5af2" },
  { key: "order", label: "订单增长", color: "#34c759" },
  { key: "revenue", label: "营收", color: "#1a9d54" },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStatsVO | null>(null);
  const [charts, setCharts] = useState<AdminChartsVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesKey>("user");

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession(); // 临时自动会话:以种子管理员(role 9)登录，AdminOnly 通过
      const [statsRes, chartsRes] = await Promise.all([
        adminDashboardApi.stats(),
        adminDashboardApi.charts(),
      ]);
      if (statsRes.success && statsRes.data) setStats(statsRes.data);
      else setError(statsRes.message || "加载统计数据失败");
      if (chartsRes.success && chartsRes.data) setCharts(chartsRes.data);
    } catch {
      setError("加载数据失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    load();
  }, [load]);

  // hero sparkline = the revenue series (numeric) over the window.
  const revenueVals = useMemo(
    () => (charts?.revenue ?? []).map((p: RevenuePoint) => Number(p.amount) || 0),
    [charts],
  );

  // 8 KPI cards from the aggregate stats block.
  const kpis = useMemo(() => {
    if (!stats) return [];
    return [
      { k: "总用户", v: fmtNum(stats.totalUsers), d: `+${fmtNum(stats.todayNewUsers)} 今日`, dir: "up" as const },
      { k: "今日新增", v: fmtNum(stats.todayNewUsers), dir: "up" as const },
      { k: "活跃用户 (7日)", v: fmtNum(stats.activeUsers), dir: "up" as const },
      { k: "付费用户", v: fmtNum(stats.payingUsers), dir: "up" as const },
      { k: "作品总数", v: fmtNum(stats.totalPosts), dir: "up" as const },
      { k: "模型总数", v: fmtNum(stats.totalModels), dir: "up" as const },
      { k: "订单总数", v: fmtNum(stats.totalOrders), d: `${fmtNum(stats.paidOrders)} 已支付`, dir: "up" as const },
      { k: "总营收", v: fmtMoney(stats.totalRevenue), dir: "up" as const },
    ];
  }, [stats]);

  // selected single-series area data: {label,value}[].
  const areaData = useMemo(() => {
    if (!charts) return [];
    if (series === "revenue") {
      return charts.revenue.map((p) => ({ label: shortDate(p.date), value: Number(p.amount) || 0 }));
    }
    const src: ChartPoint[] =
      series === "user" ? charts.userGrowth : series === "post" ? charts.postGrowth : charts.orderGrowth;
    return src.map((p) => ({ label: shortDate(p.date), value: p.count }));
  }, [charts, series]);

  // 用户 vs 作品 multi-line (vals[] per series, indexed by day).
  const multiSeries = useMemo(() => {
    if (!charts) return [];
    return [
      { name: "新增用户", color: "#0a84ff", vals: charts.userGrowth.map((p) => p.count) },
      { name: "新增作品", color: "#bf5af2", vals: charts.postGrowth.map((p) => p.count) },
    ];
  }, [charts]);

  // 订单 / 营收 area (orders count vs revenue), shown as two stacked area cards.
  const orderData = useMemo(
    () => (charts?.orderGrowth ?? []).map((p) => ({ label: shortDate(p.date), value: p.count })),
    [charts],
  );
  const revenueData = useMemo(
    () => (charts?.revenue ?? []).map((p) => ({ label: shortDate(p.date), value: Number(p.amount) || 0 })),
    [charts],
  );

  const activeMeta = SERIES_META.find((m) => m.key === series) ?? SERIES_META[0];

  const dayRange = useMemo(() => {
    const days = charts?.userGrowth ?? [];
    if (days.length === 0) return { first: "", last: "" };
    return { first: shortDate(days[0].date), last: shortDate(days[days.length - 1].date) };
  }, [charts]);

  if (loading) {
    return (
      <div className="adm-panel">
        <div className="adm-phead">
          <div>
            <h2>数据概览</h2>
            <div className="sub">正在加载…</div>
          </div>
        </div>
        <p style={{ padding: 24, color: "var(--text-faint)" }}>加载中…</p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="adm-panel">
        <div className="adm-phead">
          <div>
            <h2>数据概览</h2>
            <div className="sub">加载失败</div>
          </div>
          <div className="sp" />
          <div className="adm-tools">
            <button type="button" className="adm-btn" onClick={load}>
              重试
            </button>
          </div>
        </div>
        <p style={{ padding: 24, color: "var(--text-faint)" }}>{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="viz-grid">
        {/* hero strip — 今日营收 + inline stats + revenue sparkline */}
        <div className="viz-hero">
          <div className="viz-hero-row">
            <div className="lead">
              <div className="lbl">
                <span className="live" />
                实时营收 · 今日
              </div>
              <div className="big">{stats ? fmtMoney(stats.todayRevenue) : "¥0.00"}</div>
              <div className="chg">本月累计 {stats ? fmtMoney(stats.totalRevenue) : "¥0.00"}</div>
            </div>
            <div className="hstats">
              <div className="hstat">
                <div className="k">总订单</div>
                <div className="v">{stats ? fmtNum(stats.totalOrders) : "0"}</div>
              </div>
              <div className="hstat">
                <div className="k">已支付</div>
                <div className="v">{stats ? fmtNum(stats.paidOrders) : "0"}</div>
              </div>
              <div className="hstat">
                <div className="k">付费用户</div>
                <div className="v">{stats ? fmtNum(stats.payingUsers) : "0"}</div>
              </div>
            </div>
            <div className="hspark">
              <svg width="360" height="60" viewBox="0 0 360 60" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#fff" stopOpacity={0.5} />
                    <stop offset="1" stopColor="#fff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {revenueVals.length > 0 ? (
                  <>
                    <path d={`${sparkPath(revenueVals, 360, 60, 4)} L 356 56 L 4 56 Z`} fill="url(#hg)" />
                    <path d={sparkPath(revenueVals, 360, 60, 4)} fill="none" stroke="#fff" strokeWidth="2.5" />
                  </>
                ) : null}
              </svg>
            </div>
          </div>
        </div>

        {/* 8 KPI cards */}
        {kpis.length > 0 ? (
          <div style={{ gridColumn: "span 12" }}>
            <StatCardGrid items={kpis} />
          </div>
        ) : null}

        {/* 增长趋势 (area, switchable series) */}
        <div className="viz-card span8">
          <div className="viz-h">
            <div>
              <h3>增长趋势</h3>
              <div className="sub">近 14 天 · {activeMeta.label}</div>
            </div>
            <div className="viz-legend">
              {SERIES_META.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`adm-chip${series === m.key ? " on" : ""}`}
                  onClick={() => setSeries(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {areaData.length > 0 ? (
            <>
              <AreaTrend data={areaData} color={activeMeta.color} />
              <div className="viz-dot">
                <span>{dayRange.first}</span>
                <span>{dayRange.last}</span>
              </div>
            </>
          ) : (
            <p style={{ padding: 24, color: "var(--text-faint)" }}>暂无数据</p>
          )}
        </div>

        {/* 用户 vs 作品 (multi-line) */}
        <div className="viz-card span4">
          <div className="viz-h">
            <div>
              <h3>用户 vs 作品</h3>
              <div className="sub">近 14 天新增</div>
            </div>
            <div className="viz-legend">
              {multiSeries.map((s) => (
                <span key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          </div>
          {multiSeries.some((s) => s.vals.length > 0) ? (
            <>
              <MultiLine series={multiSeries} />
              <div className="viz-dot">
                <span>{dayRange.first}</span>
                <span>{dayRange.last}</span>
              </div>
            </>
          ) : (
            <p style={{ padding: 24, color: "var(--text-faint)" }}>暂无数据</p>
          )}
        </div>

        {/* 订单趋势 (area) */}
        <div className="viz-card span6">
          <div className="viz-h">
            <div>
              <h3>订单趋势</h3>
              <div className="sub">近 14 天 · 新增订单</div>
            </div>
          </div>
          {orderData.length > 0 ? (
            <AreaTrend data={orderData} color="#34c759" />
          ) : (
            <p style={{ padding: 24, color: "var(--text-faint)" }}>暂无数据</p>
          )}
        </div>

        {/* 营收趋势 (area) */}
        <div className="viz-card span6">
          <div className="viz-h">
            <div>
              <h3>营收趋势</h3>
              <div className="sub">近 14 天 · 已支付金额</div>
            </div>
          </div>
          {revenueData.length > 0 ? (
            <AreaTrend data={revenueData} color="#1a9d54" />
          ) : (
            <p style={{ padding: 24, color: "var(--text-faint)" }}>暂无数据</p>
          )}
        </div>
      </div>
    </>
  );
}
