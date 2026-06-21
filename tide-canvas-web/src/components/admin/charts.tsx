"use client";

/* ============================================================================
   Admin chart primitives — recharts wrappers + liuguang viz pieces.

   The dashboard (数据概览) is composed from these. recharts powers the smooth
   line/area/donut charts; the funnel / h-bars / gauges / leaderboards / model
   health board are light DOM that reuses the exact liuguang `.viz-*` classes
   (faithful to admin.js's inline-SVG renderers, re-expressed as React).

   All client-only (recharts + animation).
   ============================================================================ */

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import {
  CHART_COLORS,
  adminSwatch,
  type BarRow,
  type FunnelStep,
  type LeaderRow,
  type LineSeries,
  type ModelHealth,
  type Segment,
} from "@/mock/admin";

const GRID = "#e8e8ed";

const compact = (v: number) =>
  v >= 10000 ? (v / 10000).toFixed(1) + "w" : v.toLocaleString();
const kfmt = (v: number) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : "" + v);

/* ── area / line (recharts) ───────────────────────────────────────────────── */

/** Smooth filled area chart (生成趋势). */
export function AreaTrend({
  data,
  color = "#0a84ff",
  height = 220,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height} className="viz-svg">
      <AreaChart data={data} margin={{ top: 14, right: 14, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`area-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.26} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <YAxis hide domain={["dataMin * 0.9", "dataMax * 1.12"]} />
        <Tooltip
          cursor={{ stroke: color, strokeOpacity: 0.3 }}
          contentStyle={{ borderRadius: 10, border: "1px solid #e8e8ed", fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#area-${color})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Multi-series smooth line chart (用户增长: 新增 vs 活跃). */
export function MultiLine({
  series,
  height = 220,
}: {
  series: LineSeries[];
  height?: number;
}) {
  const n = series[0]?.vals.length ?? 0;
  const data = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number | string> = { i: `W${i + 1}` };
    series.forEach((s) => (row[s.name] = s.vals[i]));
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height} className="viz-svg">
      <LineChart data={data} margin={{ top: 14, right: 14, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <YAxis hide domain={["dataMin * 0.85", "dataMax * 1.12"]} />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e8e8ed", fontSize: 12 }} />
        {series.map((s) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Donut chart with a centered total + vertical legend (用户构成 / 模型占比 / 设备来源). */
export function Donut({ segs }: { segs: Segment[] }) {
  const total = segs.reduce((a, s) => a + s.v, 0);
  const totalLabel = total >= 1000 ? (total / 1000).toFixed(1) + "k" : "" + total;
  return (
    <div className="viz-donut-wrap">
      <div className="viz-donut-center" style={{ width: 140, height: 140 }}>
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie
              data={segs}
              dataKey="v"
              nameKey="n"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={60}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {segs.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e8e8ed", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="ctr">
          <b>{totalLabel}</b>
          <small>总计</small>
        </div>
      </div>
      <div className="viz-legend" style={{ flexDirection: "column", gap: 9 }}>
        {segs.map((s, i) => (
          <span key={s.n}>
            <i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.n} · {Math.round((s.v / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── DOM viz (faithful to admin.js renderers) ─────────────────────────────── */

/** Horizontal bar list (各模块调用量 / 地区分布 / 留存 / 积分流水). */
export function HBars({ rows, color }: { rows: BarRow[]; color?: string }) {
  const max = Math.max(...rows.map((r) => r.v));
  return (
    <div className="viz-bars">
      {rows.map((r, i) => (
        <div className="viz-bar" key={r.n}>
          <span className="nm">{r.n}</span>
          <span className="track">
            <span
              className="fill"
              style={{
                width: `${((r.v / max) * 100).toFixed(0)}%`,
                background: color || CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
          </span>
          <span className="val">{kfmt(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

/** A single labeled track bar (系统健康 平均时延 / 成功率). */
export function TrackBar({ n, pct, val, color }: { n: string; pct: number; val: string; color: string }) {
  return (
    <div className="viz-bar">
      <span className="nm">{n}</span>
      <span className="track">
        <span className="fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="val">{val}</span>
    </div>
  );
}

/** Conversion funnel (访客 → 付费). */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = steps[0]?.v ?? 1;
  return (
    <div className="viz-funnel">
      {steps.map((s, i) => {
        const pct = (s.v / max) * 100;
        return (
          <div className="fn-row" key={s.n}>
            <span className="fn-n">{s.n}</span>
            <div className="fn-track">
              <div
                className="fn-fill"
                style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
              >
                <span>{s.v >= 1000 ? (s.v / 1000).toFixed(0) + "k" : s.v}</span>
              </div>
            </div>
            <span className="fn-p">{pct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

/** Half-circle gauge (GPU 负载 / 存储占用). */
export function Gauge({ pct, label, color }: { pct: number; label: string; color?: string }) {
  const r = 54;
  const c = Math.PI * r;
  const len = (pct / 100) * c;
  const col = color || (pct > 85 ? "#ff375f" : pct > 65 ? "#ff9f0a" : "#34c759");
  return (
    <div className="viz-gauge">
      <svg width="150" height="92" viewBox="0 0 150 92">
        <path
          d={`M 16 84 A ${r} ${r} 0 0 1 134 84`}
          fill="none"
          stroke="#e8e8ed"
          strokeWidth="13"
          strokeLinecap="round"
        />
        <path
          d={`M 16 84 A ${r} ${r} 0 0 1 134 84`}
          fill="none"
          stroke={col}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${len} ${c}`}
        />
      </svg>
      <div className="gv">
        <b>{pct}%</b>
        <small>{label}</small>
      </div>
    </div>
  );
}

/** Small percent ring used inside the model-health cards. */
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const len = (pct / 100) * c;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke="#e8e8ed" strokeWidth="6" />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${len} ${c}`}
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1d1d1f">
        {pct}
      </text>
    </svg>
  );
}

/** Model health board (实时 · 成功率 / 时延 / 队列). */
export function HealthBoard({ models }: { models: ModelHealth[] }) {
  return (
    <div className="hb-grid">
      {models.map((m) => {
        const col = m.ok > 99 ? "#34c759" : m.ok > 97 ? "#ff9f0a" : "#ff375f";
        const st: [string, string] =
          m.ok > 99 ? ["正常", "green"] : m.ok > 97 ? ["波动", "amber"] : ["异常", "red"];
        return (
          <div className="hb-card" key={m.n}>
            <div className="hb-top">
              <span className="sw" style={{ background: adminSwatch(m.n) }} />
              <span className="nm">{m.n}</span>
            </div>
            <div className="hb-ring">
              <Ring pct={m.ok} color={col} />
              <div className="hb-stat">
                <div className="hb-row">
                  <span>状态</span>
                  <span className={`tag2 ${st[1]}`}>
                    <i className="dot" />
                    {st[0]}
                  </span>
                </div>
                <div className="hb-row">
                  <span>时延</span>
                  <b>{m.lat}ms</b>
                </div>
                <div className="hb-row">
                  <span>队列</span>
                  <b>{m.q}</b>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Leaderboard (用户消耗榜 / 模型使用排行榜). */
export function Leaderboard({ rows, kind }: { rows: LeaderRow[]; kind: "user" | "model" }) {
  const max = Math.max(...rows.map((r) => r.v));
  return (
    <div className="lb">
      {rows.map((r, i) => (
        <div className={`lb-row${i < 3 ? ` top${i + 1}` : ""}`} key={r.n}>
          <span className="lb-rank">{i + 1}</span>
          <div className="lb-main">
            <div className="lb-nm">
              <span
                className={kind === "user" ? "av" : "sw"}
                style={{ background: adminSwatch(r.n) }}
              />
              {r.n}
            </div>
            <div className="lb-track">
              <i
                style={{
                  width: `${((r.v / max) * 100).toFixed(0)}%`,
                  background: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
          </div>
          <div className="lb-val">
            {compact(r.v)}
            <small className={r.up >= 0 ? "up" : "down"}>
              {r.up >= 0 ? "↑" : "↓"}
              {Math.abs(r.up)}%
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
