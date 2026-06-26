import type { PageQuery } from "./api";

export interface RechargeOrderVO {
  id: number;
  orderNo: string;
  amount: number;
  pointsAmount: number;
  paymentMethod: string;
  paymentNo?: string;
  status: number;
  statusName: string;
  paidTime: string;
  createTime: string;
}

/** 发起在线支付返回:对 payUrl 以 form POST 提交 params 跳转网关收银台 */
export interface PaymentInitiateVO {
  payUrl: string;
  params: Record<string, string>;
  orderNo: string;
}

export interface RechargeConfigVO {
  ratio: number;
  onlinePayEnabled: boolean;
  payTypes: string[];
}

/** 支付方式显示名(易支付 type 取值) */
export const PAY_TYPE_NAMES: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  qqpay: "QQ钱包",
  bank: "网银支付",
  jdpay: "京东支付",
  paypal: "PayPal",
  douyinpay: "抖音支付",
};

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
  TIMEOUT = 4,
}

export const ORDER_STATUS_NAMES: Record<number, string> = {
  0: "待支付",
  1: "已支付",
  2: "已取消",
  3: "已退款",
  4: "已超时",
};
