// ============================================================================
// 灵感管理 (Inspiration) mock — ported 1:1 from design-ref/liuguang/admin.js
// V.insp() + inspModal(). 100% mock.
//
// Sections:
//  - INSPIRATION_KPIS  → the 4 .adm-kpis tiles
//  - COLLECTIONS       → 灵感配置 table (cover / 标题 / 类型 / 关联作品 / 排序 / 展示)
//  - PROMPTS           → 提示词库 table (the section's "prompt library")
//  - COLLECTION_*      → option lists feeding the CRUD modal selects/chips.
//
// The cover field is a raw hue triplet; derive the CSS via mesh(...cover).
// ============================================================================

import { mesh } from "@/lib/mesh";
import type { Kpi } from "@/mock/admin";

export { mesh };

/** 灵感条目 / 主题合集 / 提示词库 / 今日采用. */
export const INSPIRATION_KPIS: Kpi[] = [
  { k: "灵感条目", v: "4,820", d: "+36 本周", dir: "up" },
  { k: "主题合集", v: "128", dir: "up" },
  { k: "提示词库", v: "12,640", d: "+210", dir: "up" },
  { k: "今日采用", v: "8,902", d: "+6%", dir: "up" },
];

/** A 灵感合集 row. */
export interface Collection {
  /** Raw hue triplet for the mesh cover; derive CSS via mesh(...cover). */
  cover: [number, number, number];
  /** 标题. */
  title: string;
  /** 合集 | 主题 | 提示词. */
  type: "合集" | "主题" | "提示词";
  /** 关联作品数. */
  linkedWorks: number;
  /** 排序. */
  sort: number;
  /** 是否在灵感页展示. */
  visible: boolean;
}

const COLLECTION_TYPES_CYCLE = ["合集", "主题", "提示词"] as const;

/** 灵感配置 — 管理灵感页的标签、合集与精选. */
export const COLLECTIONS: Collection[] = ["国风 Q 版", "赛博废土", "黄昏人像", "液态金属", "微缩星球"].map(
  (title, i) => ({
    cover: [40 + i * 60, 90 + i * 30, 200 + i * 20] as [number, number, number],
    title,
    type: COLLECTION_TYPES_CYCLE[i % 3],
    linkedWorks: 320 - i * 40,
    sort: i + 1,
    visible: i !== 3,
  }),
);

/** A 提示词库 row (the inspiration section's prompt library). */
export interface PromptEntry {
  /** 提示词标题. */
  title: string;
  /** 分类标签. */
  tags: string[];
  /** 采用次数. */
  used: number;
  /** 关联合集. */
  collection: string;
  /** 是否启用. */
  enabled: boolean;
}

/** 提示词库 — 高频提示词与采用情况. */
export const PROMPTS: PromptEntry[] = [
  { title: "霓虹废土行者", tags: ["赛博朋克", "人像"], used: 4820, collection: "赛博废土", enabled: true },
  { title: "国风水墨少女", tags: ["国风", "Q 版"], used: 3610, collection: "国风 Q 版", enabled: true },
  { title: "黄昏逆光人像", tags: ["人像", "写实"], used: 2940, collection: "黄昏人像", enabled: true },
  { title: "液态金属雕塑", tags: ["3D", "写实"], used: 2180, collection: "液态金属", enabled: true },
  { title: "微缩玻璃星球", tags: ["3D", "动漫"], used: 1560, collection: "微缩星球", enabled: false },
  { title: "电影感城市夜景", tags: ["写实", "赛博朋克"], used: 1320, collection: "赛博废土", enabled: true },
];

/** 灵感配置 筛选 chips. */
export const INSPIRATION_FILTERS = ["灵感", "主题", "提示词"] as const;

/** 提示词库 筛选 chips. */
export const PROMPT_FILTERS = ["全部", "图像", "视频", "已停用"] as const;

/** inspModal — 类型 select options. */
export const COLLECTION_TYPE_OPTIONS = ["合集", "主题", "提示词"] as const;

/** inspModal — 标签 (multi-select chips). */
export const PROMPT_TAG_OPTIONS = ["国风", "Q 版", "赛博朋克", "人像", "3D", "动漫", "写实"] as const;
