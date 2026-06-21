// ============================================================================
// 支付管理 (Payments) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.pay (lines ~282-299).
//
// Shape:
//  - PAYMENTS_KPIS    : the 4 .kpi cards (今日交易 / 成功率 / 退款 / 待对账)
//  - PAYMENT_CHANNELS : 支付渠道 table (渠道 / 类型 / 费率 / 今日金额 / 回调 / 状态)
//  - PAYMENT_ORDERS   : 最近交易 table (订单号 / 用户 / 套餐·商品 / 金额 / 渠道 / 时间 / 状态)
//
// Orders are built from the shared NAMES list (admin.js line 67) so authors match
// the rest of the console.
// ============================================================================

import type { Kpi, PillTone } from "@/mock/admin";

/** 4 KPI cards at the top of 支付管理. */
export const PAYMENTS_KPIS: Kpi[] = [
  { k: "今日交易", v: "¥384,920", d: "+11%", dir: "up" },
  { k: "成功率", v: "98.6%", d: "+0.2%", dir: "up" },
  { k: "退款", v: "¥4,210", d: "", dir: "down" },
  { k: "待对账", v: "6", d: "", dir: "down" },
];

/** A payment channel (支付渠道). */
export interface PaymentChannel {
  /** 渠道 name, e.g. 微信支付. */
  name: string;
  /** 类型, e.g. 扫码 / JSAPI. */
  type: string;
  /** 费率, e.g. "0.6%". */
  rate: string;
  /** 今日金额, e.g. "¥182,400". */
  todayAmount: string;
  /** 回调 status pill (正常 / 延迟). */
  callback: { label: string; tone: PillTone };
  /** Whether the channel is enabled (sw toggle). */
  enabled: boolean;
}

/** 支付渠道 — 渠道开关、费率与回调. */
export const PAYMENT_CHANNELS: PaymentChannel[] = [
  { name: "微信支付", type: "扫码 / JSAPI", rate: "0.6%", todayAmount: "¥182,400", callback: { label: "正常", tone: "green" }, enabled: true },
  { name: "支付宝", type: "扫码 / APP", rate: "0.6%", todayAmount: "¥150,200", callback: { label: "正常", tone: "green" }, enabled: true },
  { name: "Apple IAP", type: "应用内", rate: "15%", todayAmount: "¥38,900", callback: { label: "正常", tone: "green" }, enabled: true },
  { name: "Stripe", type: "海外卡", rate: "2.9%", todayAmount: "¥13,420", callback: { label: "延迟", tone: "amber" }, enabled: true },
];

/** A payment order / transaction (最近交易). */
export interface PaymentOrder {
  /** 订单号, e.g. "#PAY20260212000". */
  orderNo: string;
  /** 用户. */
  user: string;
  /** 套餐 / 商品. */
  item: string;
  /** 金额, e.g. "¥468". */
  amount: string;
  /** 渠道, e.g. 微信. */
  channel: string;
  /** 时间, e.g. "10:30". */
  time: string;
  /** 状态 pill (成功 / 退款). */
  status: { label: string; tone: PillTone };
}

/** Shared NAMES (admin.js line 67) — authors for the recent transactions. */
const ORDER_NAMES = ["夜航 NightSail", "KENJI", "砚 Yan", "Mira", "Studio 3F"] as const;
const ORDER_ITEMS = ["创作者 Pro 年付", "积分 3000", "企业版 月付", "创作者 Pro 月付", "积分 1000"] as const;
const ORDER_AMOUNTS = ["468", "198", "199", "39", "68"] as const;
const ORDER_CHANNELS = ["微信", "支付宝", "Apple", "微信", "Stripe"] as const;

/** 最近交易 — recent transactions (NAMES.slice(0,5), faithful to admin.js). */
export const PAYMENT_ORDERS: PaymentOrder[] = ORDER_NAMES.map((name, i) => ({
  orderNo: `#PAY${20260212000 + i}`,
  user: name,
  item: ORDER_ITEMS[i],
  amount: `¥${ORDER_AMOUNTS[i]}`,
  channel: ORDER_CHANNELS[i],
  time: `10:${30 - i}`,
  status: i === 4 ? { label: "退款", tone: "red" } : { label: "成功", tone: "green" },
}));
