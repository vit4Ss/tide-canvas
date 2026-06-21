// ============================================================================
// 营销管理 (Marketing) mock — ported 1:1 from design-ref/liuguang/admin.js
// V.marketing() + mktModal(). 100% mock, matching the rest of the liuguang
// admin console.
//
// Sections:
//  - MARKETING_KPIS  → the 4 .adm-kpis tiles
//  - CAMPAIGNS       → 营销活动 table (运营活动 / Banner / 投放)
//  - COUPONS         → 优惠券 / 兑换码 table
//  - CHANNEL_ROI     → 渠道投放 · 渠道 ROI h-bars
//  - CAMPAIGN_* / COUPON_* option lists feed the CRUD modal selects/chips.
// ============================================================================

import type { Kpi, PillTone } from "@/mock/admin";
import type { BarRow } from "@/mock/admin";

/** 进行中活动 / 今日券核销 / 活动带来营收 / 拉新 ROI. */
export const MARKETING_KPIS: Kpi[] = [
  { k: "进行中活动", v: "8", d: "+2 本周", dir: "up" },
  { k: "今日券核销", v: "4,218", d: "+9%", dir: "up" },
  { k: "活动带来营收", v: "¥86,400", d: "+14%", dir: "up" },
  { k: "拉新 ROI", v: "3.8×", d: "+0.4", dir: "up" },
];

/** A 营销活动 row. */
export interface Campaign {
  /** 活动名称. */
  name: string;
  /** 促销 | 拉新 | 裂变 | 活动 | 线索. */
  type: string;
  /** 周期 (e.g. "02-01 ~ 02-29" / "长期" / "已结束"). */
  period: string;
  /** 参与 (e.g. "12.4k"). */
  participants: string;
  /** 转化 (e.g. "8.2%" / "—"). */
  conversion: string;
  /** 状态 label + tone. */
  status: { label: string; tone: PillTone };
}

/** 营销活动 — 运营活动、Banner 与投放. */
export const CAMPAIGNS: Campaign[] = [
  {
    name: "限时年付 -42%",
    type: "促销",
    period: "02-01 ~ 02-29",
    participants: "12.4k",
    conversion: "8.2%",
    status: { label: "进行中", tone: "green" },
  },
  {
    name: "新人 7 天礼包",
    type: "拉新",
    period: "长期",
    participants: "48k",
    conversion: "21%",
    status: { label: "进行中", tone: "green" },
  },
  {
    name: "老带新裂变",
    type: "裂变",
    period: "01-10 ~ 02-20",
    participants: "9.8k",
    conversion: "12%",
    status: { label: "进行中", tone: "green" },
  },
  {
    name: "春节创作大赛",
    type: "活动",
    period: "已结束",
    participants: "32k",
    conversion: "—",
    status: { label: "已结束", tone: "gray" },
  },
  {
    name: "企业试用",
    type: "线索",
    period: "长期",
    participants: "1.2k",
    conversion: "6%",
    status: { label: "进行中", tone: "green" },
  },
];

/** A 优惠券 / 兑换码 row. */
export interface Coupon {
  /** 名称. */
  name: string;
  /** 满减 | 折扣 | 兑换 | 直减. */
  type: string;
  /** 面额 / 力度 (e.g. "¥20" / "8 折" / "+500 积分"). */
  strength: string;
  /** 已领 / 已用 (e.g. "50k / 38k"). */
  usage: string;
  /** 有效期 (e.g. "~ 02-20"). */
  validity: string;
  /** 启用开关. */
  enabled: boolean;
}

/** 优惠券 / 兑换码. */
export const COUPONS: Coupon[] = [
  { name: "新人券", type: "满减", strength: "¥20", usage: "50k / 38k", validity: "~ 02-20", enabled: true },
  { name: "会员折扣", type: "折扣", strength: "8 折", usage: "20k / 12k", validity: "~ 02-21", enabled: true },
  { name: "积分礼包码", type: "兑换", strength: "+500 积分", usage: "10k / 7.2k", validity: "~ 02-22", enabled: true },
  { name: "回归券", type: "直减", strength: "¥15", usage: "8k / 2.1k", validity: "~ 02-23", enabled: false },
];

/** 渠道投放 · 渠道 ROI — 近 30 天各投放渠道表现. */
export const CHANNEL_ROI: BarRow[] = [
  { n: "抖音", v: 4200 },
  { n: "小红书", v: 3600 },
  { n: "微信", v: 2800 },
  { n: "B 站", v: 1900 },
  { n: "SEO", v: 1500 },
];

/** 获客成本 CAC — cfg-card rows (label + value). */
export const CHANNEL_CAC: { label: string; value: string }[] = [
  { label: "本月 CAC", value: "¥18.6" },
  { label: "目标 CAC", value: "≤ ¥22" },
  { label: "LTV / CAC", value: "4.2×" },
];

/** 活动列表筛选 chips. */
export const CAMPAIGN_FILTERS = ["全部", "进行中", "待开始", "已结束"] as const;

/** mktModal — 活动类型 select options. */
export const CAMPAIGN_TYPES = ["促销", "拉新", "裂变", "活动", "线索"] as const;

/** mktModal — 优惠券类型 select options. */
export const COUPON_TYPES = ["满减", "折扣", "兑换", "直减"] as const;

/** mktModal — 适用人群 (single-select chips). */
export const AUDIENCE_OPTIONS = ["全部", "新用户", "付费会员", "流失用户"] as const;

/** mktModal — 渠道 (multi-select chips). */
export const CHANNEL_OPTIONS = ["站内", "抖音", "小红书", "微信", "短信"] as const;
