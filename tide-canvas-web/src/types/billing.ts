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

/** Point top-up bundle shown alongside plans (PointPackageVO). */
export interface PointPackageVO {
  id: string;
  name: string;
  points: number;
  bonusPoints: number;
  price: number;
}

/** epay pay method. Maps to the backend payChannel → epay type. */
export type PayChannel = "alipay" | "wxpay";

/** Body for POST /api/orders (CreateOrderDTO). Exactly one of planId /
 *  packageId is required, matching `type`. */
export interface CreateOrderDTO {
  type: "plan" | "point_package";
  planId?: string;
  packageId?: string;
  payChannel?: PayChannel;
}

/** Order view returned by create/list/detail (OrderVO). On creation `payUrl`
 *  is the epay cashier URL to redirect the browser to. Status:
 *  0 待支付 / 1 已支付 / 2 已取消 / 3 已退款. */
export interface OrderVO {
  id: string;
  orderNo: string;
  type: string;
  planId?: string | null;
  amount: number;
  status: number;
  payTime?: string | null;
  createTime: string;
  payUrl?: string;
}

/** Result of the return_url verification backstop (VerifyResult). */
export interface VerifyResult {
  paid: boolean;
  granted: boolean;
}
