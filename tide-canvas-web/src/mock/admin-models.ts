// ============================================================================
// 模型管理 (Models) mock data — ported 1:1 from design-ref/liuguang/admin.js.
//
// admin.js V.models() renders the first 7 of the shared MODELS array, deriving
// vendor / type / pointCost / callVolume / enabled positionally from the row
// index. We freeze those derived values into typed rows here so the table is a
// faithful 1:1 of the prototype (same names, vendors, costs, volumes, states).
//
// The rich edit modal options (quality / resolution / generation modes / count
// tiers / aspect ratios / vendors / types) are also ported verbatim from
// admin.js modelModal() so the AdminModal form matches the design exactly.
// ============================================================================

import type { PillTone } from "@/mock/admin";

/** A model row in the 模型管理 table. */
export interface AdminModel {
  name: string;
  /** 厂商 — e.g. OpenAI / Black Forest. */
  vendor: string;
  /** 类型 — 图片 | 视频. */
  type: "图片" | "视频";
  /** Tone for the type tag (admin.js: 视频→blue, 图片→gray). */
  typeTone: PillTone;
  /** 单次积分 — point cost per call. */
  pointCost: number;
  /** 调用量 — formatted, e.g. "1.2M". */
  callVolume: string;
  /** 状态 — on/off switch (上下架). */
  enabled: boolean;
}

/** The shared MODELS name list from admin.js (full 8). */
export const MODEL_NAMES = [
  "GPT Image 2",
  "Flux.1 Pro",
  "Midjourney v6",
  "Nano Banana 2",
  "Seedance 2.0",
  "可灵 Kling 1.6",
  "即梦 3.0",
  "SDXL Lightning",
] as const;

// Positional derivations from admin.js V.models() (rows = MODELS.slice(0,7)):
//   vendor:     ['OpenAI','Black Forest','Midjourney','Google','字节跳动','快手','字节']
//   type:       i%4===0 ? '视频' : '图片'   (tone: 视频→blue, 图片→gray)
//   pointCost:  [10,12,14,10,30,30,12]
//   callVolume: (1.2 - i*0.12).toFixed(1) + 'M'
//   enabled:    i !== 6
const VENDORS = ["OpenAI", "Black Forest", "Midjourney", "Google", "字节跳动", "快手", "字节"];
const POINT_COSTS = [10, 12, 14, 10, 30, 30, 12];

export const MODELS: AdminModel[] = MODEL_NAMES.slice(0, 7).map((name, i) => {
  const isVideo = i % 4 === 0;
  return {
    name,
    vendor: VENDORS[i],
    type: isVideo ? "视频" : "图片",
    typeTone: isVideo ? "blue" : "gray",
    pointCost: POINT_COSTS[i],
    callVolume: `${(1.2 - i * 0.12).toFixed(1)}M`,
    enabled: i !== 6,
  };
});

/** KPI tiles above the table — ported from admin.js kpis([...]). */
export const MODEL_KPIS = [
  { k: "接入模型", v: "32", d: "+1 本周", dir: "up" as const },
  { k: "图片模型", v: "20", d: "", dir: "up" as const },
  { k: "视频模型", v: "9", d: "", dir: "up" as const },
  { k: "平均时延", v: "3.4s", d: "-0.2s", dir: "up" as const },
];

/** Filter chips above the table. */
export const MODEL_FILTERS = ["全部", "图片", "视频", "音频"] as const;

/* ──────────────────────────────────────────────────────────────────────────
   Rich edit-modal option sets — verbatim from admin.js modelModal().
   ──────────────────────────────────────────────────────────────────────── */

export const MODEL_TYPES = ["图片生成", "视频生成", "音频生成"] as const;
export const MODEL_VENDORS = [
  "请选择供应商",
  "OpenAI",
  "Black Forest",
  "字节跳动",
  "快手",
] as const;

/** 支持画质 (quality tiers) — also the rows of the pricing matrix. */
export const MODEL_QUALITIES = ["低画质", "标准画质", "高画质"] as const;
/** 支持清晰度 (resolutions) — also the columns of the pricing matrix. */
export const MODEL_RESOLUTIONS = ["1K", "2K", "4K"] as const;

/** 支持的生成方式 (generation modes) + default selection. */
export const MODEL_GEN_MODES = ["文生图", "图生图"] as const;
export const MODEL_GEN_MODES_DEFAULT = ["文生图"];

/** 出图张数档位 (count tiers) + default selection. */
export const MODEL_COUNT_TIERS = ["1 张", "2 张", "3 张", "4 张"] as const;
export const MODEL_COUNT_TIERS_DEFAULT = ["1 张", "2 张", "4 张"];

/** 上游四宫格输出 (single-select). */
export const MODEL_QUAD_OUTPUT = ["是（单张 2×2 合图）", "否（独立多张）"] as const;
export const MODEL_QUAD_OUTPUT_DEFAULT = ["否（独立多张）"];

/** 支持比例 (aspect ratios) + default selection. */
export const MODEL_ASPECTS = [
  "自适应",
  "1:1",
  "1:2",
  "2:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
] as const;
export const MODEL_ASPECTS_DEFAULT = ["自适应", "1:1", "16:9", "9:16"];
