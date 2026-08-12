import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";

/**
 * Points API — the current user's balance, ledger and daily check-in.
 * Mirrors tide-canvas-server/internal/handler/points (all routes auth).
 */

/** BalanceVO — current usable balance; frozen is reserved/held points. */
export interface BalanceVO {
  points: number;
  frozen: number;
}

/** PointRecordVO — one ledger row. changeType: recharge / consume / checkin /
 *  reward / refund. amount is signed (+gain / -consumption). */
export interface PointRecordVO {
  id: string;
  changeType: string;
  amount: number;
  balance: number;
  remark: string;
  refId?: string | null;
  createTime: string;
}

/** CheckinStatusVO — whether today's check-in is done and the streak length. */
export interface CheckinStatusVO {
  checkedToday: boolean;
  continuousDays: number;
  /** 本月签到积分已达后台配置的上限(下次签到无法发放),账户页据此置灰按钮 */
  monthlyCapReached?: boolean;
}

/** CheckinResultVO — points awarded by POST /checkin (rewarded=false when
 *  already checked in today; idempotent). */
export interface CheckinResultVO {
  points: number;
  continuousDays: number;
  rewarded: boolean;
}

export interface ActivationCodeRedeemVO {
  points: number;
  balance: number;
  redeemedAt: string;
}

export const pointsApi = {
  balance: () => http.get<BalanceVO>("/api/points/balance"),
  records: (query: { pageNum?: number; pageSize?: number; changeType?: string }) =>
    http.get<PageData<PointRecordVO>>("/api/points/records", toParams(query)),
  checkinStatus: () => http.get<CheckinStatusVO>("/api/points/checkin"),
  checkin: () => http.post<CheckinResultVO>("/api/points/checkin"),
  redeemActivationCode: (code: string) =>
    http.post<ActivationCodeRedeemVO>("/api/points/activation-code/redeem", { code }),
};
