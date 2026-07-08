// Billing types — mirror the backend billing VOs
// (tide-canvas-server/internal/handler/billing/vo.go). All id fields are string.

/** Pricing-card view of a subscription plan (PlanVO). */
export interface PlanVO {
  id: string;
  name: string;
  desc: string;
  monthly: number;
  yearly: number;
  monthlyPoints: number;
  featured: boolean;
  cta: string;
  items: string[];
}

/** 方案对比表的一行：能力名 + 每套餐一格（键=套餐 id；"✓" 支持 / "—" 不支持 / 文字）。 */
export interface CompareRow {
  label: string;
  values: Record<string, string>;
}

/** GET /api/billing/compare — 对比表行内容；列由客户端用真实套餐拼装。 */
export interface CompareVO {
  rows: CompareRow[];
}

/** 定价页 FAQ 的一条问答。 */
export interface FaqItem {
  q: string;
  a: string;
}

/** GET /api/billing/faq — 定价页常见问题（后台价格管理可编辑）。 */
export interface FaqVO {
  items: FaqItem[];
}

/** epay pay method. Maps to the backend payChannel → epay type. */
export type PayChannel = "alipay" | "wxpay";

/** One selectable pay method (PayChannelVO), driven by the 管理后台 支付渠道
 *  enabled switches (GET /api/billing/channels). */
export interface PayChannelVO {
  key: PayChannel;
  name: string;
}

/** Billing cycle for plan orders. Yearly charges 12 × the plan's discounted
 *  per-month yearly price and grants 12 × the monthly points. */
export type BillCycle = "monthly" | "yearly";

/** Body for POST /api/orders (CreateOrderDTO). Only plan purchases are
 *  accepted — 积分随套餐发放，无单独积分包通道。 */
export interface CreateOrderDTO {
  type: "plan";
  planId: string;
  payChannel?: PayChannel;
  cycle?: BillCycle;
}

/** Order view returned by create/list/detail (OrderVO). On creation `payUrl`
 *  is the epay cashier URL to redirect the browser to. Status:
 *  0 待支付 / 1 已支付 / 2 已取消 / 3 已退款. */
export interface OrderVO {
  id: string;
  orderNo: string;
  type: string;
  planId?: string | null;
  /** Billing cycle for plan orders ("monthly" / "yearly"); absent for packages. */
  cycle?: string;
  amount: number;
  status: number;
  payTime?: string | null;
  createTime: string;
  /** Checkout deadline (createTime + 30min), present only while pending.
   *  过期的待支付订单会被服务端懒取消。 */
  expireTime?: string | null;
  /** epay cashier URL. Present on creation, and on GET detail while the order
   *  is still pending (regenerated server-side for 继续支付). */
  payUrl?: string;
}

/** Result of the return_url verification backstop (VerifyResult). */
export interface VerifyResult {
  paid: boolean;
  granted: boolean;
}
