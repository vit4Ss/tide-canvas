// ============================================================================
// 积分管理 (Points) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.credit (lines ~249-264).
//
// Shape:
//  - POINTS_KPIS        : the 4 .kpi cards (流通积分 / 今日消耗 / 今日充值 / 赠送积分)
//  - POINTS_RULES       : 积分规则 table (规则 / 场景 / 消耗·赠送 / 触发条件 / 状态)
//  - POINTS_CONFIG      : 积分全局配置 (赠送有效期 + ¥→积分 汇率)
//  - POINTS_LEDGER      : 积分流水 ledger (synthesized from the dashboard CREDIT_FLOW
//    breakdown + a faithful row table so the section has the ledger the spec calls for)
// ============================================================================

import type { Kpi } from "@/mock/admin";

/** 4 KPI cards at the top of 积分管理. */
export const POINTS_KPIS: Kpi[] = [
  { k: "流通积分", v: "1.42 亿", d: "+3%", dir: "up" },
  { k: "今日消耗", v: "9.02M", d: "+8%", dir: "up" },
  { k: "今日充值", v: "¥182,400", d: "+12%", dir: "up" },
  { k: "赠送积分", v: "24.1M", d: "", dir: "up" },
];

/** A single 积分规则 row. */
export interface PointRule {
  /** 规则 name, e.g. 文生图. */
  name: string;
  /** 场景, e.g. 创作台. */
  scene: string;
  /** 消耗 / 赠送 amount string, e.g. "-10 / 张" or "+200". */
  amount: string;
  /** 触发条件, e.g. 每次生成. */
  trigger: string;
  /** Whether the rule is enabled (sw toggle). */
  enabled: boolean;
}

/** 积分规则 — 消耗规则、赠送与有效期. */
export const POINTS_RULES: PointRule[] = [
  { name: "文生图", scene: "创作台", amount: "-10 / 张", trigger: "每次生成", enabled: true },
  { name: "文生视频", scene: "创作台", amount: "-30 / 段", trigger: "每次生成", enabled: true },
  { name: "新用户礼包", scene: "注册", amount: "+200", trigger: "首次注册", enabled: true },
  { name: "每日签到", scene: "活跃", amount: "+10", trigger: "每日一次", enabled: true },
  { name: "邀请好友", scene: "裂变", amount: "+100", trigger: "成功邀请", enabled: true },
];

/** A ledger row (积分流水). */
export interface PointLedgerRow {
  /** 时间 timestamp. */
  time: string;
  /** 用户 / 来源. */
  user: string;
  /** 类型, e.g. 消耗 / 充值 / 赠送 / 退还. */
  type: "消耗" | "充值" | "赠送" | "退还";
  /** 变动 amount (signed string), e.g. "-30" or "+3,000". */
  delta: string;
  /** 余额 after the change. */
  balance: string;
  /** 说明. */
  note: string;
}

/** 积分流水 — recent ledger entries. */
export const POINTS_LEDGER: PointLedgerRow[] = [
  { time: "10:32", user: "夜航 NightSail", type: "消耗", delta: "-30", balance: "12,840", note: "文生视频 ×1" },
  { time: "10:28", user: "KENJI", type: "充值", delta: "+3,000", balance: "48,200", note: "¥39 充值包" },
  { time: "10:19", user: "砚 Yan", type: "消耗", delta: "-10", balance: "6,120", note: "文生图 ×1" },
  { time: "10:05", user: "Mira", type: "赠送", delta: "+200", balance: "1,200", note: "新用户礼包" },
  { time: "09:58", user: "Studio 3F", type: "充值", delta: "+20,000", balance: "204,800", note: "企业版充值" },
  { time: "09:44", user: "OceanLab", type: "退还", delta: "+10", balance: "3,410", note: "生成失败退还" },
  { time: "09:31", user: "Vega", type: "消耗", delta: "-30", balance: "880", note: "图生视频 ×1" },
  { time: "09:12", user: "稻田 Paddy", type: "赠送", delta: "+10", balance: "640", note: "每日签到" },
];

/** Status-pill tone per ledger type. */
export const LEDGER_TONE: Record<PointLedgerRow["type"], "red" | "green" | "blue" | "gray"> = {
  消耗: "red",
  充值: "green",
  赠送: "blue",
  退还: "gray",
};

/** 积分全局配置 — gift validity + ¥→积分 rate. */
export interface PointsConfig {
  /** 赠送积分有效期 (天). */
  giftValidityDays: number;
  /** 1 元 = N 积分. */
  yuanToPoints: number;
  /** 大额加赠 toggle. */
  bigTopUpBonus: boolean;
}

export const POINTS_CONFIG: PointsConfig = {
  giftValidityDays: 90,
  yuanToPoints: 100,
  bigTopUpBonus: true,
};
