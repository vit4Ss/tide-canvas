// ============================================================================
// 作品管理 (Works) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.works(). Mock only.
//
//   - WORK_KPIS         → the 4 top KPI cards (总作品 / 今日生成 / …)
//   - WORK_FILTERS / WORK_ROWS         → 作品库 table
//   - MODERATION_FILTERS / MODERATION_ROWS → 审核管理 queue (机审 + 人工复核)
//   - MODERATION_POLICIES              → 审核策略 toggle cards (cfg-grid)
// ============================================================================

import { mesh, type Kpi, type PillTone } from "@/mock/admin";

const NAMES = [
  "夜航 NightSail",
  "KENJI",
  "砚 Yan",
  "Mira",
  "Studio 3F",
  "OceanLab",
];

const MODELS = [
  "GPT Image 2",
  "Flux.1 Pro",
  "Midjourney v6",
  "Nano Banana 2",
  "Seedance 2.0",
  "可灵 Kling 1.6",
  "即梦 3.0",
  "SDXL Lightning",
];

/* ──────────────────────────────────────────────────────────────────────────
   KPI cards
   ──────────────────────────────────────────────────────────────────────── */

export const WORK_KPIS: Kpi[] = [
  { k: "总作品", v: "208,441,920", d: "+1.9M 今日", dir: "up" },
  { k: "今日生成", v: "1,902,338", d: "+8.7%", dir: "up" },
  { k: "公开作品", v: "64,200,118", dir: "up" },
  { k: "举报待审", v: "38", dir: "down" },
];

/* ──────────────────────────────────────────────────────────────────────────
   作品库 (works table)
   ──────────────────────────────────────────────────────────────────────── */

export const WORK_FILTERS = ["全部", "图片", "视频", "精选", "已举报"] as const;

export interface WorkRow {
  id: string;
  /** Deterministic mesh cover gradient. */
  cover: string;
  author: string;
  model: string;
  likes: number;
  type: "图片" | "视频";
  typeTone: PillTone;
  status: string;
  statusTone: PillTone;
}

// admin.js: NAMES.slice(0,6).map((n,i) => …); i%3===0 → 视频, i===2 → 已举报.
export const WORK_ROWS: WorkRow[] = NAMES.slice(0, 6).map((n, i) => ({
  id: `作品 #${10240 + i}`,
  cover: mesh(20 + i * 50, 60 + i * 40, 120 + i * 30),
  author: n,
  model: MODELS[i % MODELS.length],
  likes: 12000 - i * 1500,
  type: i % 3 === 0 ? "视频" : "图片",
  typeTone: i % 3 === 0 ? "blue" : "gray",
  status: i === 2 ? "已举报" : "已发布",
  statusTone: i === 2 ? "amber" : "green",
}));

/* ──────────────────────────────────────────────────────────────────────────
   审核管理 (moderation queue)
   ──────────────────────────────────────────────────────────────────────── */

export const MODERATION_FILTERS = ["全部", "待审", "机审拦截", "用户举报", "申诉"] as const;

export interface ModerationRow {
  id: string;
  cover: string;
  submitter: string;
  /** 用户举报 | 机审拦截 | 申诉. */
  source: string;
  sourceTone: PillTone;
  /** Risk label (涉政 / 血腥 / 色情 / 版权 / 其它). */
  risk: string;
  /** Machine-audit score 0..1. */
  score: number;
  /** Cell color for the score (red >0.7, amber >0.4, green otherwise). */
  scoreColor: string;
  status: string;
  statusTone: PillTone;
}

function sourceTone(src: string): PillTone {
  if (src === "机审拦截") return "red";
  if (src === "申诉") return "blue";
  return "amber";
}

function scoreColor(s: number): string {
  return s > 0.7 ? "#e0334b" : s > 0.4 ? "#bf7c00" : "#1a9d54";
}

// admin.js inline array of [id, submitter, source, risk, score, status].
const MODERATION_RAW: [string, string, string, string, number, string][] = [
  ["作品 #20451", "KENJI", "用户举报", "涉政", 0.92, "待审"],
  ["作品 #20448", "夜航", "机审拦截", "血腥", 0.81, "待审"],
  ["作品 #20440", "Mira", "机审拦截", "色情", 0.76, "待审"],
  ["作品 #20431", "Vega", "申诉", "版权", 0.34, "复核"],
  ["作品 #20410", "砚 Yan", "用户举报", "其它", 0.21, "待审"],
];

export const MODERATION_ROWS: ModerationRow[] = MODERATION_RAW.map((r, i) => ({
  id: r[0],
  cover: mesh(40 + i * 44, 90 + i * 30, 160 + i * 20),
  submitter: r[1],
  source: r[2],
  sourceTone: sourceTone(r[2]),
  risk: r[3],
  score: r[4],
  scoreColor: scoreColor(r[4]),
  status: r[5],
  statusTone: r[5] === "复核" ? "blue" : "amber",
}));

/* ──────────────────────────────────────────────────────────────────────────
   审核策略 (policy toggle cards)
   ──────────────────────────────────────────────────────────────────────── */

/** A single row inside a policy card: a toggle, a number input, or a select. */
export type PolicyControl =
  | { kind: "switch"; label: string; on: boolean }
  | { kind: "number"; label: string; value: string; unit?: string };

export interface PolicyCard {
  title: string;
  desc: string;
  rows: PolicyControl[];
}

export const MODERATION_POLICIES: PolicyCard[] = [
  {
    title: "机器审核",
    desc: "生成内容的自动安全检测。",
    rows: [
      { kind: "switch", label: "机审开关", on: true },
      { kind: "number", label: "自动拦截阈值", value: "0.75", unit: "0–1" },
      { kind: "number", label: "人工复核阈值", value: "0.40", unit: "0–1" },
    ],
  },
  {
    title: "送审范围",
    desc: "哪些内容需要审核。",
    rows: [
      { kind: "switch", label: "公开作品先审后发", on: true },
      { kind: "switch", label: "私有作品免审", on: true },
      { kind: "switch", label: "视频抽帧审核", on: true },
    ],
  },
  {
    title: "违规处置",
    desc: "命中后的默认动作。",
    rows: [
      { kind: "switch", label: "命中即下架", on: true },
      { kind: "switch", label: "累计 3 次封号", on: true },
      { kind: "switch", label: "通知作者", on: true },
    ],
  },
];
