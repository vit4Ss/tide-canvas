import type { PageQuery } from "./api";

export interface PointsBalanceVO {
  points: number;
  todayCheckedIn: boolean;
}

export interface PointsTransactionVO {
  id: number;
  amount: number;
  balanceAfter: number;
  type: number;
  typeName: string;
  bizId: number;
  remark: string;
  createTime: string;
}

export interface CheckinStatusVO {
  checkedInToday: boolean;
  streakDays: number;
  pointsAwarded: number;
}

export interface CheckinCalendarVO {
  dates: string[];
}

export interface PointsTransactionQuery extends PageQuery {
  userId?: number;
  type?: number;
  startTime?: string;
  endTime?: string;
}

export enum PointsTransactionType {
  RECHARGE = 1,
  CHECKIN = 2,
  AI_CONSUME = 3,
  BLOG_VIEW = 4,
  TIP_OUT = 5,
  TIP_IN = 6,
  ADMIN_ADJUST = 7,
  AI_REFUND = 8,
}

export const POINTS_TYPE_NAMES: Record<number, string> = {
  1: "充值",
  2: "签到",
  3: "AI 消耗",
  4: "查看博客",
  5: "打赏支出",
  6: "收到打赏",
  7: "管理员调整",
  8: "生成失败返还",
};
