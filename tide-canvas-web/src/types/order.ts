import type { PageQuery } from "./api";

export interface RechargeOrderVO {
  id: number;
  orderNo: string;
  amount: number;
  pointsAmount: number;
  paymentMethod: string;
  status: number;
  statusName: string;
  paidTime: string;
  createTime: string;
}

export interface RechargeCreateDTO {
  amount: number;
  paymentMethod?: string;
}

export interface OrderQuery extends PageQuery {
  status?: number;
  startTime?: string;
  endTime?: string;
}

export enum OrderStatus {
  PENDING = 0,
  PAID = 1,
  CANCELLED = 2,
  REFUNDED = 3,
}

export const ORDER_STATUS_NAMES: Record<number, string> = {
  0: "待支付",
  1: "已支付",
  2: "已取消",
  3: "已退款",
};
