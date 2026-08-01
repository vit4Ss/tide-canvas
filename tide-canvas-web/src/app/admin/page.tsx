"use client";

/* ============================================================================
   /admin — 数据概览 (dense ops dashboard).

   Layout:
     1. Compact hero: today revenue + key counters
     2. 4 honest metrics (not 8 vanity cards)
     3. One switchable trend chart + user/post multi-line
     4. Quick links to high-frequency ops tasks
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AreaTrend, MultiLine } from "@/components/admin/charts";
import {
  AdminAlert,
  AdminEmptyState,
  FilterChips,
  ListSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminDashboardApi } from "@/lib/admin-dashboard-api";
import type {
  AdminChartsVO,
  AdminStatsVO,
  ChartPoint,
  RevenuePoint,
} from "@/types/admin-dashboard";

const fmtDurMs = (ms: number) =>
  ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toLocaleString("zh-Hans-CN")}ms`;

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

function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5) : d;
}

const fmtNum = (n: number) => n.toLocaleString("zh-Hans-CN");

function fmtMoney(s: string): string {
  const n = Number(s);
  return Number.isFinite(n)
    ? `¥${n.toLocaleString("zh-Hans-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `¥${s}`;
}

type SeriesKey = "user" | "post" | "order" | "revenue";

const CHART_BLUE = "var(--chart-blue)";
const CHART_TEAL = "var(--chart-cyan)";
const SERIES_META: { key: SeriesKey; label: string; color: string }[] = [
  { key: "user", label: "用户", color: CHART_BLUE },
  { key: "post", label: "作品", color: CHART_BLUE },
  { key: "order", label: "订单", color: CHART_BLUE },
  { key: "revenue", label: "营收", color: CHART_BLUE },
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
      await ensureSession();
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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const revenueVals = useMemo(
    () => (charts?.revenue ?? []).map((p: RevenuePoint) => Number(p.amount) || 0),
    [charts],
  );

  // 指标带第二行：核心运营指标 + 内容盘子，全部收进 hero 一张卡
  //（此前 hero 右侧钉三个小数 + 下方再横一条四格，两条半空横幅割裂又空旷）。
  const heroMetrics = useMemo(() => {
    if (!stats) return [];
    const todayUsers = stats.todayNewUsers;
    return [
      {
        k: "总用户",
        v: fmtNum(stats.totalUsers),
        d: todayUsers > 0 ? `今日 +${fmtNum(todayUsers)}` : "今日 +0",
        dir: todayUsers > 0 ? ("up" as const) : undefined,
      },
      { k: "7 日活跃", v: fmtNum(stats.activeUsers) },
      { k: "付费用户", v: fmtNum(stats.payingUsers) },
      {
        k: "订单",
        v: fmtNum(stats.totalOrders),
        d: `${fmtNum(stats.paidOrders)} 已支付`,
      },
      { k: "作品", v: fmtNum(stats.totalPosts) },
      { k: "模型", v: fmtNum(stats.totalModels) },
    ];
  }, [stats]);

  const areaData = useMemo(() => {
    if (!charts) return [];
    if (series === "revenue") {
      return charts.revenue.map((p) => ({
        label: shortDate(p.date),
        value: Number(p.amount) || 0,
      }));
    }
    const src: ChartPoint[] =
      series === "user"
        ? charts.userGrowth
        : series === "post"
          ? charts.postGrowth
          : charts.orderGrowth;
    return src.map((p) => ({ label: shortDate(p.date), value: p.count }));
  }, [charts, series]);

  const multiSeries = useMemo(() => {
    if (!charts) return [];
    return [
      { name: "新增用户", color: CHART_BLUE, vals: charts.userGrowth.map((p) => p.count) },
      { name: "新增作品", color: CHART_TEAL, vals: charts.postGrowth.map((p) => p.count) },
    ];
  }, [charts]);

  const activeMeta = SERIES_META.find((m) => m.key === series) ?? SERIES_META[0];

  // 模型调用（近 14 天）：总调用 vs 成功 双线 + Top5 榜
  const callSeries = useMemo(() => {
    const pts = charts?.modelCalls ?? [];
    return [
      { name: "调用量", color: CHART_BLUE, vals: pts.map((p) => p.count) },
      { name: "成功", color: CHART_TEAL, vals: pts.map((p) => p.success) },
    ];
  }, [charts]);
  const callTotal = useMemo(
    () => (charts?.modelCalls ?? []).reduce((n, p) => n + p.count, 0),
    [charts],
  );
  const callSuccess = useMemo(
    () => (charts?.modelCalls ?? []).reduce((n, p) => n + p.success, 0),
    [charts],
  );
  const modelTop = charts?.modelTop ?? [];
  const topMax = modelTop.length ? Math.max(...modelTop.map((m) => m.count)) : 0;

  const dayRange = useMemo(() => {
    const days = charts?.userGrowth ?? [];
    if (days.length === 0) return { first: "", last: "" };
    return { first: shortDate(days[0].date), last: shortDate(days[days.length - 1].date) };
  }, [charts]);

  const hasTrendSignal = useMemo(() => {
    return areaData.some((p) => p.value > 0) || multiSeries.some((s) => s.vals.some((v) => v > 0));
  }, [areaData, multiSeries]);

  if (loading) {
    // 骨架屏形状对齐真实首屏：指标带 + 两块图表面板
    return (
      <>
        <div
          className="skel skel-card"
          aria-hidden="true"
          style={{ height: 176, borderRadius: "var(--r-lg)" }}
        />
        <ListSkeleton rows={2} height={280} gap={14} onField />
      </>
    );
  }

  if (error && !stats) {
    return (
      <div className="adm-page">
        <AdminAlert
          tone="error"
          title="数据概览加载失败"
          action={
          <button type="button" className="adm-btn" onClick={load}>
            <RefreshCw aria-hidden size={15} />
            重新加载
          </button>
          }
        >
          {error}
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <div className="viz-hero">
        <div className="viz-hero-row">
          <div className="lead">
            <div className="lbl">
              <span className="live" />
              今日营收
            </div>
            <div className="big">{stats ? fmtMoney(stats.todayRevenue) : "¥0.00"}</div>
            <div className="chg">累计 {stats ? fmtMoney(stats.totalRevenue) : "¥0.00"}</div>
          </div>
          {revenueVals.some((v) => v > 0) ? (
            <div className="hspark">
              <svg
                width="220"
                height="44"
                viewBox="0 0 220 44"
                preserveAspectRatio="none"
                role="img"
                aria-label="近 14 天营收走势"
              >
                <title>近 14 天营收走势</title>
                <defs>
                  <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={CHART_BLUE} stopOpacity={0.1} />
                    <stop offset="1" stopColor={CHART_BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={`${sparkPath(revenueVals, 220, 44, 3)} L 217 41 L 3 41 Z`} fill="url(#hg)" />
                <path
                  d={sparkPath(revenueVals, 220, 44, 3)}
                  fill="none"
                  stroke={CHART_BLUE}
                  strokeWidth="1.75"
                />
              </svg>
            </div>
          ) : null}
        </div>

        {heroMetrics.length > 0 ? (
          <dl className="viz-hero-metrics">
            {heroMetrics.map((m) => (
              <div className="hm" key={m.k}>
                <dt className="k">{m.k}</dt>
                <dd className="v">{m.v}</dd>
                {m.d ? <div className={`d${m.dir === "up" ? " up" : ""}`}>{m.d}</div> : null}
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="viz-grid">
        <div className="viz-card span8">
          <div className="viz-h">
            <div>
              <h3>增长趋势</h3>
              <div className="sub">近 14 天 · {activeMeta.label}</div>
            </div>
            <FilterChips
              label="趋势指标"
              options={SERIES_META.map((item) => item.label)}
              value={activeMeta.label}
              onChange={(_, index) => setSeries(SERIES_META[index].key)}
            />
          </div>
          {areaData.length > 0 && hasTrendSignal ? (
            <>
              <AreaTrend data={areaData} color={activeMeta.color} />
              <div className="viz-dot">
                <span>{dayRange.first}</span>
                <span>{dayRange.last}</span>
              </div>
            </>
          ) : (
            <AdminEmptyState
              title="暂无增长信号"
              description="近 14 天无新增数据时，趋势图会保持空白，避免平线误导。"
            />
          )}
        </div>

        <div className="viz-card span4">
          <div className="viz-h">
            <div>
              <h3>用户 vs 作品</h3>
              <div className="sub">近 14 天新增</div>
            </div>
          </div>
          {multiSeries.some((s) => s.vals.some((v) => v > 0)) ? (
            <>
              <MultiLine series={multiSeries} />
              <div className="viz-legend">
                {multiSeries.map((s) => (
                  <span key={s.name}>
                    <i style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
              <div className="viz-dot">
                <span>{dayRange.first}</span>
                <span>{dayRange.last}</span>
              </div>
            </>
          ) : (
            <AdminEmptyState
              title="暂无对照数据"
              description="有用户或作品增长后会显示双轴对照。"
            />
          )}
        </div>
      </div>

      <div className="viz-grid">
        <div className="viz-card span8">
          <div className="viz-h">
            <div>
              <h3>模型调用</h3>
              <div className="sub">
                近 14 天 · 共 {fmtNum(callTotal)} 次
                {callTotal > 0 ? ` · 成功 ${((callSuccess / callTotal) * 100).toFixed(1)}%` : ""}
              </div>
            </div>
          </div>
          {callSeries.some((s) => s.vals.some((v) => v > 0)) ? (
            <>
              <MultiLine series={callSeries} />
              <div className="viz-legend">
                {callSeries.map((s) => (
                  <span key={s.name}>
                    <i style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
              <div className="viz-dot">
                <span>{dayRange.first}</span>
                <span>{dayRange.last}</span>
              </div>
            </>
          ) : (
            <AdminEmptyState
              title="暂无模型调用"
              description="用户在创作台 / 对话发起生成后，这里会按天累计调用量与成功率。"
            />
          )}
        </div>

        <div className="viz-card span4">
          <div className="viz-h">
            <div>
              <h3>调用 Top 5</h3>
              <div className="sub">近 14 天 · 按调用量</div>
            </div>
          </div>
          {modelTop.length > 0 ? (
            <div className="viz-bars">
              {modelTop.map((m) => (
                <div className="vb" key={m.model}>
                  <div className="vb-line">
                    <span className="vb-name" title={m.modelName || m.model}>
                      {m.modelName || m.model}
                    </span>
                    <span className="vb-n">{fmtNum(m.count)}</span>
                  </div>
                  <div className="vb-bar">
                    <i style={{ width: topMax > 0 ? `${(m.count / topMax) * 100}%` : 0 }} />
                  </div>
                  <div className="vb-sub">
                    成功 {m.count > 0 ? ((m.success / m.count) * 100).toFixed(1) : "0"}% · 均耗时{" "}
                    {fmtDurMs(m.avgMs)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmptyState title="暂无调用记录" description="有真实模型调用后显示排行。" />
          )}
        </div>
      </div>

      <div className="viz-card span12">
        <div className="viz-h">
          <div>
            <h3>快捷入口</h3>
            <div className="sub">高频运营任务</div>
          </div>
        </div>
        <div className="adm-quick">
          <Link href="/admin/users">
            <span className="qk">用户管理</span>
            <span className="qs">检索、封禁、调积分</span>
          </Link>
          <Link href="/admin/works">
            <span className="qk">作品管理</span>
            <span className="qs">审核与下架</span>
          </Link>
          <Link href="/admin/models">
            <span className="qk">模型管理</span>
            <span className="qs">上下架与同步</span>
          </Link>
          <Link href="/admin/payments">
            <span className="qk">支付管理</span>
            <span className="qs">渠道与订单流水</span>
          </Link>
          <Link href="/admin/logs">
            <span className="qk">日志管理</span>
            <span className="qs">错误与模型调用</span>
          </Link>
          <Link href="/admin/config">
            <span className="qk">配置管理</span>
            <span className="qs">站点与系统参数</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
