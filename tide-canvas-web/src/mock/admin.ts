// ============================================================================
// Admin console shared primitives — types + color helpers + sidebar icons.
//
// 历史：本模块最初承载 design-ref/liuguang/admin.js 的整套 dashboard mock 数据。
// 后台各页面已全部接入真实 /api/admin/* 接口（2026-07 审计确认无任何页面消费
// mock 数据），这里只保留仍被引用的共享原语：
//  - 类型：Kpi / PillTone / 图表行类型（charts.tsx 复用）
//  - adminSwatch(name)：名字哈希 → 双色渐变（头像/模型芯片/榜单字形）
//  - CHART_COLORS：recharts 类目色板（用户定稿 v3）
//  - ADMIN_ICONS：侧边栏 SVG path 表
// 已废弃的 mock 数据集（DASHBOARD_* / TREND / *_LEADERBOARD / OPS_ROWS …）
// 与各 section 的 mock 文件（admin-users/-works/…）一并删除。
// ============================================================================

import { hueSwatch } from "@/lib/swatch";

/* ──────────────────────────────────────────────────────────────────────────
   Color helpers
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic 2-tone gradient from a name string (avatars, model chips,
 * leaderboard glyphs). Ported from admin.js `swatch(n)`.
 */
export function adminSwatch(name: string): string {
  // 浅色工作台：柔和彩色（身份识别靠颜色；灰阶是前台 imini 的铁律，后台不适用）
  return hueSwatch(name);
}

/** The recharts categorical palette used across all admin charts. */
/* 图表色板（用户定稿 v3）：蓝 → 青双主轴，浅阶收尾——类目靠图例/标签区分，
   颜色表达"同一体系内的次序"（语义红绿另走 charts.tsx 常量）。 */
export const CHART_COLORS = [
  "#0071E3", // 主苹果蓝
  "#30B0C7", // 图表青
  "#7FB8F0", // 蓝浅阶
  "#9BD6E0", // 青浅阶
  "#AEAEB2", // 冷灰
  "#6E6E73", // 深冷灰
] as const;

/* ──────────────────────────────────────────────────────────────────────────
   Cross-section shared types
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

/* ── chart row types (consumed by components/admin/charts.tsx) ───────────── */

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

/* ──────────────────────────────────────────────────────────────────────────
   Icon paths (SVG `d` strings) — ported from admin.js ICON map.
   Used by the sidebar nav.
   ──────────────────────────────────────────────────────────────────────── */

export const ADMIN_ICONS: Record<string, string> = {
  dash: "M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-6H3z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  works: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  insp: "M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1-1 2H9c0-1-.3-1.4-1-2A6 6 0 0 1 12 3z",
  log: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6",
  floor: "M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-7h6v7",
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
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
};
