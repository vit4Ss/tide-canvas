// ============================================================================
// 日志管理 (Logs) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.logs(). Mock only.
//
//   - LOG_KPIS     → the 4 top KPI cards (今日日志 / 错误率 / 告警 / 平均响应)
//   - LOG_FILTERS  → 系统日志 filter chips (全部 / 操作审计 / 错误 / 安全 / 支付)
//   - LOG_ROWS     → the 系统日志 table rows (time/level/module/message/ip/operator)
// ============================================================================

import type { Kpi, PillTone } from "@/mock/admin";

/* ──────────────────────────────────────────────────────────────────────────
   KPI cards
   ──────────────────────────────────────────────────────────────────────── */

export const LOG_KPIS: Kpi[] = [
  { k: "今日日志", v: "2,418,902", dir: "up" },
  { k: "错误率", v: "0.04%", d: "-0.01%", dir: "up" },
  { k: "告警", v: "12", dir: "down" },
  { k: "平均响应", v: "142ms", d: "-8ms", dir: "up" },
];

/* ──────────────────────────────────────────────────────────────────────────
   系统日志 (log table)
   ──────────────────────────────────────────────────────────────────────── */

export const LOG_FILTERS = ["全部", "操作审计", "错误", "安全", "支付"] as const;

export type LogLevel = "INFO" | "WARN" | "ERROR" | "SECURITY";

export interface LogRow {
  time: string;
  level: LogLevel;
  /** Tone for the level tag (INFO=gray, WARN=amber, ERROR=red, SECURITY=blue). */
  levelTone: PillTone;
  module: string;
  /** 操作 / 信息 message. */
  message: string;
  ip: string;
  operator: string;
}

const LEVEL_TONES: Record<LogLevel, PillTone> = {
  INFO: "gray",
  WARN: "amber",
  ERROR: "red",
  SECURITY: "blue",
};

// admin.js inline array of [level, message, module, operator]; time/ip derived
// from the index: `2026-02-12 10:${20-i}:0${i}` and `10.2.${i}.${100+i}`.
const LOG_RAW: [LogLevel, string, string, string][] = [
  ["INFO", "用户登录成功", "auth", "夜航 NightSail"],
  ["WARN", "支付回调超时重试", "pay", "系统"],
  ["ERROR", "模型推理队列堆积", "model", "系统"],
  ["INFO", "作品批量下架 ×12", "works", "admin"],
  ["SECURITY", "异常登录拦截", "auth", "风控"],
];

export const LOG_ROWS: LogRow[] = LOG_RAW.map((r, i) => ({
  time: `2026-02-12 10:${20 - i}:0${i}`,
  level: r[0],
  levelTone: LEVEL_TONES[r[0]],
  module: r[2],
  message: r[1],
  ip: `10.2.${i}.${100 + i}`,
  operator: r[3],
}));
