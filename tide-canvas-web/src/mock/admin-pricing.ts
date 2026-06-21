// ============================================================================
// 价格管理 (Pricing) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.price (lines ~266-280).
//
// Shape:
//  - PRICING_KPIS    : the 4 .kpi cards (在售套餐 / 月付占比 / 年付占比 / ARPU)
//  - PRICING_PLANS   : 套餐管理 table (套餐 / 月价 / 年价 / 每月积分 / 权益 / 状态)
//  - PRICING_PROMOS  : 促销与折扣 table (活动 / 类型 / 力度 / 有效期 / 已用·限量 / 状态)
// ============================================================================

import type { Kpi, PillTone } from "@/mock/admin";

/** 4 KPI cards at the top of 价格管理. */
export const PRICING_KPIS: Kpi[] = [
  { k: "在售套餐", v: "3", d: "", dir: "up" },
  { k: "月付占比", v: "38%", d: "", dir: "up" },
  { k: "年付占比", v: "62%", d: "+4%", dir: "up" },
  { k: "ARPU", v: "¥58", d: "+5%", dir: "up" },
];

/** A membership plan (套餐). */
export interface PricingPlan {
  /** 套餐 name. */
  name: string;
  /** 月价, e.g. "¥39". */
  monthly: string;
  /** 年价, e.g. "¥468". */
  yearly: string;
  /** 每月积分, e.g. "3,000". */
  monthlyPoints: string;
  /** 权益 summary. */
  benefits: string;
  /** Whether the plan is on-sale (sw toggle). */
  status: boolean;
  /** Optional badge (e.g. 热门) shown after the name. */
  badge?: { label: string; tone: PillTone };
}

/** 套餐管理 — 会员套餐定价与权益. */
export const PRICING_PLANS: PricingPlan[] = [
  { name: "体验版", monthly: "¥0", yearly: "¥0", monthlyPoints: "100", benefits: "基础模型", status: true },
  {
    name: "创作者 Pro",
    monthly: "¥39",
    yearly: "¥468",
    monthlyPoints: "3,000",
    benefits: "全模型 · 高清",
    status: true,
    badge: { label: "热门", tone: "amber" },
  },
  { name: "企业版", monthly: "¥199", yearly: "¥1,990", monthlyPoints: "20,000", benefits: "API · 商用授权", status: true },
];

/** A promotion / discount (促销与折扣). */
export interface Promotion {
  /** 活动 name. */
  name: string;
  /** 类型, e.g. 直降 / 满减 / 折扣. */
  type: string;
  /** 力度, e.g. "-42%" / "¥20" / "8 折". */
  strength: string;
  /** 有效期, e.g. "~ 02-29" / "长期" / "已结束". */
  validity: string;
  /** 已用 / 限量, e.g. "12.4k / ∞". */
  usage: string;
  /** 状态 pill (进行中 / 已结束). */
  status: { label: string; tone: PillTone };
}

/** 促销与折扣. */
export const PRICING_PROMOS: Promotion[] = [
  { name: "限时年付", type: "直降", strength: "-42%", validity: "~ 02-29", usage: "12.4k / ∞", status: { label: "进行中", tone: "green" } },
  { name: "新人券", type: "满减", strength: "¥20", validity: "长期", usage: "8.9k / 50k", status: { label: "进行中", tone: "green" } },
  { name: "双十二", type: "折扣", strength: "8 折", validity: "已结束", usage: "40k / 40k", status: { label: "已结束", tone: "gray" } },
];
