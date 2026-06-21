// ============================================================================
// Admin console mock data — ported 1:1 from design-ref/liuguang/admin.js.
//
// The /admin console is 100% mock (matching the rest of the liuguang design).
// This module owns the 数据概览 (dashboard) data plus cross-section shared
// types + small color helpers that every section page reuses. Section-specific
// mock (users / works / pricing / …) is added by later agents alongside their
// pages — keep this module focused on the dashboard + shared primitives.
//
// Color helpers:
//  - adminSwatch(name): hash a name → a 2-tone linear-gradient (avatars / model
//    chips / leaderboard glyphs). Direct port of admin.js `swatch()`.
//  - mesh(...) is re-exported from "@/lib/mesh" for work/cover tiles.
// ============================================================================

import { mesh } from "@/lib/mesh";

export { mesh };

/* ──────────────────────────────────────────────────────────────────────────
   Color helpers
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic 2-tone gradient from a name string (avatars, model chips,
 * leaderboard glyphs). Ported from admin.js `swatch(n)`.
 */
export function adminSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg,hsl(${h} 78% 60%),hsl(${(h + 50) % 360} 78% 50%))`;
}

/** The recharts categorical palette used across all admin charts. */
export const CHART_COLORS = [
  "#0a84ff",
  "#34c759",
  "#ff9f0a",
  "#ff375f",
  "#bf5af2",
  "#5ac8fa",
] as const;

/* ──────────────────────────────────────────────────────────────────────────
   Cross-section shared types (a small barrel for later section agents)
   ──────────────────────────────────────────────────────────────────────── */

/** up = positive/green delta, down = negative/red delta. */
export type Trend = "up" | "down";

/** Status-pill tone keys → map to liuguang `.tag2.<tone>` classes. */
export type PillTone = "green" | "gray" | "amber" | "red" | "blue";

/** A single KPI tile (label / value / optional delta). */
export interface Kpi {
  /** Label, e.g. "总用户". */
  k: string;
  /** Formatted value, e.g. "5,218,904". */
  v: string;
  /** Optional delta text, e.g. "+12,304 今日". Empty/undefined hides it. */
  d?: string;
  /** Delta direction (defaults to "up"). */
  dir?: Trend;
}

/** A platform user row (shared shape for 用户管理 etc.). */
export interface AdminUser {
  name: string;
  email: string;
  /** 免费 | Pro 会员 | 企业 … */
  level: string;
  credits: number;
  monthlySpend: number;
  lastActive: string;
  /** true = 正常, false = 已封禁. */
  active: boolean;
}

/** A work/artwork row (shared shape for 作品管理 etc.). */
export interface AdminWork {
  id: string;
  /** Raw hue triplet for the mesh cover; derive CSS via mesh(...cover). */
  cover: [number, number, number];
  author: string;
  model: string;
  likes: number;
  type: "图片" | "视频";
  status: string;
}

/* ──────────────────────────────────────────────────────────────────────────
   Dashboard (数据概览) types
   ──────────────────────────────────────────────────────────────────────── */

/** Hero strip on the dashboard (今日实时营收). */
export interface DashboardHero {
  /** Big revenue figure, e.g. "¥384,920". */
  revenue: string;
  /** Delta line, e.g. "↑ 11.2% 较昨日 · 本月累计 ¥9.84M". */
  change: string;
  /** Compact inline stats (今日订单 / 客单价 / 实时在线). */
  stats: { k: string; v: string }[];
  /** Sparkline series (shared with the trend chart). */
  spark: number[];
}

/** A dashboard KPI card (KPI + colored icon + mini sparkline). */
export interface DashboardKpi extends Kpi {
  /** Icon key into ADMIN_ICONS. */
  icon: string;
  /** Accent color (hex) for the icon badge + sparkline. */
  color: string;
}

/** A named numeric segment for donut charts. */
export interface Segment {
  n: string;
  v: number;
}

/** A named numeric row for horizontal bar lists. */
export interface BarRow {
  n: string;
  v: number;
}

/** A funnel step (visit → pay). */
export interface FunnelStep {
  n: string;
  v: number;
}

/** A multi-series line (用户增长: 新增 vs 活跃). */
export interface LineSeries {
  /** Series label. */
  name: string;
  /** Line color (hex). */
  color: string;
  /** Per-x values. */
  vals: number[];
}

/** A model-health row (success rate / latency / queue). */
export interface ModelHealth {
  n: string;
  /** Success rate %, e.g. 99.6. */
  ok: number;
  /** Latency in ms. */
  lat: number;
  /** Queue depth. */
  q: number;
}

/** A leaderboard row (user consumption / model usage). */
export interface LeaderRow {
  n: string;
  v: number;
  /** Week-over-week % change (signed). */
  up: number;
}

/** A real-time ops table row (实时运营). */
export interface OpsRow {
  time: string;
  event: string;
  module: string;
  value: string;
  status: { label: string; tone: PillTone };
}

/** A todo / review-queue row (待办与审核). */
export interface TodoRow {
  type: string;
  content: string;
  submitter: string;
  time: string;
  status: { label: string; tone: PillTone };
}

/* ──────────────────────────────────────────────────────────────────────────
   Icon paths (SVG `d` strings) — ported from admin.js ICON map.
   Used by the sidebar nav + dashboard KPI badges.
   ──────────────────────────────────────────────────────────────────────── */

export const ADMIN_ICONS: Record<string, string> = {
  dash: "M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-6H3z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  works: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  insp: "M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1-1 2H9c0-1-.3-1.4-1-2A6 6 0 0 1 12 3z",
  log: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6",
  floor: "M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-7h6v7",
  discover: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  model: "M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 2v18M4 6.5l8 4.5 8-4.5",
  res: "M3 7l2-3h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z",
  credit:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.5 9.5a2.5 2.5 0 0 1 5 0M12 7v1M12 16v1M9 14h6",
  price: "M20 12l-8 8-9-9V4h7zM7.5 7.5h.01",
  pay: "M2 7h20v12H2zM2 11h20M6 15h4",
  chart: "M3 3v18h18M7 14l3-4 3 3 4-6",
  promo: "M3 11l18-5v12L3 14v-3zM7 12v6a2 2 0 0 0 4 0v-5",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 14H4a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 8.4l-.38-.38a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11H20a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  mail: "M3 6h18v12H3zM3 7l9 7 9-7",
};

/* ──────────────────────────────────────────────────────────────────────────
   Dashboard data — ported from admin.js V.viz() + V.dashTables().
   ──────────────────────────────────────────────────────────────────────── */

/** Generation-trend series (近 13 天 · 单位万次). Shared by hero + trend chart. */
export const TREND: number[] = [42, 48, 45, 60, 58, 72, 70, 85, 80, 96, 92, 110, 120];

export const DASHBOARD_HERO: DashboardHero = {
  revenue: "¥384,920",
  change: "↑ 11.2% 较昨日 · 本月累计 ¥9.84M",
  stats: [
    { k: "今日订单", v: "6,418" },
    { k: "客单价", v: "¥59.9" },
    { k: "实时在线", v: "12,043" },
  ],
  spark: TREND,
};

/** The 8 top KPI cards (总用户 / DAU / MAU / 今日生成 / 付费会员 / 付费转化 / 今日营收 / ARPU). */
export const DASHBOARD_KPIS: DashboardKpi[] = [
  { k: "总用户", v: "5,218,904", d: "+2.4%", dir: "up", icon: "users", color: "#0a84ff" },
  { k: "日活 DAU", v: "486,210", d: "+5.1%", dir: "up", icon: "chart", color: "#34c759" },
  { k: "月活 MAU", v: "3.82M", d: "+3.4%", dir: "up", icon: "chart", color: "#5ac8fa" },
  { k: "今日生成", v: "1,902,338", d: "+8.7%", dir: "up", icon: "works", color: "#bf5af2" },
  { k: "付费会员", v: "352,118", d: "+1.9%", dir: "up", icon: "credit", color: "#ff9f0a" },
  { k: "付费转化", v: "6.8%", d: "-0.3%", dir: "down", icon: "price", color: "#ff375f" },
  { k: "今日营收", v: "¥384.9K", d: "+11%", dir: "up", icon: "pay", color: "#1a9d54" },
  { k: "ARPU", v: "¥58.2", d: "+5%", dir: "up", icon: "credit", color: "#0a84ff" },
];

/** 生成趋势 — labeled trend points (13 days). */
export const GENERATION_TREND: { label: string; value: number }[] = TREND.map(
  (value, i) => ({ label: `D${i + 1}`, value }),
);

/** 用户构成 — donut by membership level. */
export const USER_COMPOSITION: Segment[] = [
  { n: "免费用户", v: 4520 },
  { n: "Pro 会员", v: 352 },
  { n: "企业版", v: 86 },
  { n: "试用中", v: 260 },
];

/** 用户增长 — 近 12 周 · 新增 vs 活跃 (multi-line). */
export const USER_GROWTH: LineSeries[] = [
  { name: "新增", color: "#0a84ff", vals: [12, 14, 13, 18, 20, 19, 24, 26, 25, 30, 34, 38] },
  { name: "活跃", color: "#34c759", vals: [40, 44, 46, 52, 55, 60, 64, 70, 76, 82, 90, 98] },
];

/** 转化漏斗 — 访客 → 付费. */
export const CONVERSION_FUNNEL: FunnelStep[] = [
  { n: "访问", v: 100000 },
  { n: "注册", v: 42000 },
  { n: "生成", v: 28000 },
  { n: "加购", v: 9800 },
  { n: "付费", v: 6800 },
];

/** 模型调用占比 — 本周 (donut). */
export const MODEL_USAGE: Segment[] = [
  { n: "GPT Image 2", v: 4200 },
  { n: "Flux.1 Pro", v: 2600 },
  { n: "Seedance", v: 1800 },
  { n: "可灵", v: 1200 },
  { n: "其它", v: 900 },
];

/** 各模块调用量 — 今日 (h-bars). */
export const MODULE_CALLS: BarRow[] = [
  { n: "文生图", v: 9200 },
  { n: "图生图", v: 5400 },
  { n: "文生视频", v: 3100 },
  { n: "图生视频", v: 1800 },
  { n: "改图", v: 1200 },
];

/** 地区分布 — 活跃用户 Top 5 (h-bars). */
export const REGION_DIST: BarRow[] = [
  { n: "广东", v: 880 },
  { n: "海外", v: 920 },
  { n: "北京", v: 720 },
  { n: "上海", v: 690 },
  { n: "浙江", v: 540 },
];

/** 设备来源 — 本周会话 (donut). */
export const DEVICE_SOURCE: Segment[] = [
  { n: "iOS", v: 3800 },
  { n: "Android", v: 3200 },
  { n: "Web", v: 2400 },
  { n: "小程序", v: 1400 },
];

/** 留存率 — 次日 / 7日 / 30日 (h-bars, %). */
export const RETENTION: BarRow[] = [
  { n: "次日 D1", v: 52 },
  { n: "7 日 D7", v: 34 },
  { n: "30 日 D30", v: 21 },
];

/** 积分流水 — 今日 (h-bars). */
export const CREDIT_FLOW: BarRow[] = [
  { n: "消耗", v: 9020 },
  { n: "充值", v: 6240 },
  { n: "赠送", v: 2410 },
  { n: "退还", v: 320 },
];

/** 系统健康 gauges (GPU 负载 / 存储占用). */
export const SYSTEM_GAUGES: { label: string; pct: number }[] = [
  { label: "GPU 负载", pct: 72 },
  { label: "存储占用", pct: 43 },
];

/** 系统健康 — 平均时延 / 成功率 (track bars, 0..100). */
export const SYSTEM_BARS: { n: string; pct: number; val: string; color: string }[] = [
  { n: "平均时延", pct: 34, val: "142ms", color: "#34c759" },
  { n: "成功率", pct: 98, val: "98.6%", color: "#34c759" },
];

/** 模型健康度 — 实时 (success / latency / queue board). */
export const MODEL_HEALTH: ModelHealth[] = [
  { n: "GPT Image 2", ok: 99.6, lat: 132, q: 12 },
  { n: "Flux.1 Pro", ok: 99.2, lat: 168, q: 8 },
  { n: "Seedance 2.0", ok: 98.1, lat: 940, q: 34 },
  { n: "可灵 Kling 1.6", ok: 96.4, lat: 1120, q: 58 },
  { n: "Midjourney v6", ok: 99.8, lat: 210, q: 4 },
  { n: "即梦 3.0", ok: 99.1, lat: 156, q: 9 },
];

/** 用户消耗榜 — 本月积分消耗 Top 6. */
export const USER_LEADERBOARD: LeaderRow[] = [
  { n: "KENJI", v: 184200, up: 12 },
  { n: "夜航 NightSail", v: 152600, up: 8 },
  { n: "Studio 3F", v: 121800, up: -3 },
  { n: "Mira", v: 98400, up: 5 },
  { n: "砚 Yan", v: 76200, up: 2 },
  { n: "Vega", v: 64800, up: -1 },
];

/** 模型使用排行榜 — 本周调用次数. */
export const MODEL_LEADERBOARD: LeaderRow[] = [
  { n: "GPT Image 2", v: 1240000, up: 9 },
  { n: "Flux.1 Pro", v: 862000, up: 6 },
  { n: "Seedance 2.0", v: 540000, up: 22 },
  { n: "可灵 Kling 1.6", v: 410000, up: 14 },
  { n: "Midjourney v6", v: 320000, up: -4 },
  { n: "即梦 3.0", v: 286000, up: 7 },
];

/** 实时运营 — 近 24 小时关键指标. */
export const OPS_ROWS: OpsRow[] = [
  { time: "10:24", event: "生成峰值", module: "创作台", value: "12,400 / 分", status: { label: "正常", tone: "green" } },
  { time: "09:50", event: "新模型上线", module: "模型管理", value: "Seedance 2.0", status: { label: "已发布", tone: "blue" } },
  { time: "08:31", event: "支付回调延迟", module: "支付管理", value: "+1.2s", status: { label: "告警", tone: "amber" } },
  { time: "02:10", event: "批量清理缓存", module: "资源管理", value: "38 GB", status: { label: "完成", tone: "gray" } },
];

/** 待办与审核 — review queue. */
export const TODO_ROWS: TodoRow[] = [
  { type: "作品举报", content: "涉嫌违规图像 ×3", submitter: "系统", time: "5 分钟前", status: { label: "待审", tone: "amber" } },
  { type: "提现申请", content: "¥2,400 创作者分成", submitter: "KENJI", time: "1 小时前", status: { label: "待审", tone: "amber" } },
  { type: "模型申请", content: "社区 LoRA 上架", submitter: "砚 Yan", time: "3 小时前", status: { label: "待审", tone: "amber" } },
];
