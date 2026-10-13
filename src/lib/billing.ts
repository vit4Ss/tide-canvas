import type { PlanVO, BillCycle, OrderVO } from "@/types/billing";
export function planPurchase(plan: PlanVO, cycle: BillCycle) {
  // Both regular and promotional yearly prices are annual totals from the API.
  const total = Number(cycle === "monthly" ? plan.promo?.monthly || plan.monthly : plan.promo?.yearly || plan.yearly);
  const free = Number(plan.monthly) === 0;
  return {
    monthlyEquivalent: cycle === "yearly" ? total / 12 : total,
    total,
    credits: plan.monthlyPoints * (cycle === "yearly" && !free ? 12 : 1),
    available: Number.isFinite(total) && total >= 0 && (cycle !== "yearly" || free || total > 0),
  };
}

export function isEnglishPlan(plan: PlanVO) {
  return plan.market === "en" && plan.currency === "USD";
}

export function checkoutUrl(order: { payUrl?: string; currency?: string; payMethod?: string }): string {
  if (!order.payUrl) return "";
  try {
    const url = new URL(order.payUrl);
    if (url.username || url.password) return "";
    if (order.currency === "USD" || order.payMethod === "stripe") {
      return url.protocol === "https:" && url.host === "checkout.stripe.com" ? url.href : "";
    }
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function purchaseChanged(order: OrderVO, plan: PlanVO, cycle: BillCycle): boolean {
  const purchase = planPurchase(plan, cycle);
  return (order.amount !== undefined && order.amount !== purchase.total)
    || (order.credits !== undefined && order.credits !== purchase.credits)
    || (!!order.currency && order.currency !== "USD")
    || (!!order.cycle && order.cycle !== cycle)
    || (!!order.planId && order.planId !== plan.id);
}

// Only a new, fully confirmed order matching the buyer's displayed selection
// may skip the recovery page. Reused, changed or incomplete orders need review.
export function directCheckoutUrl(order: OrderVO, plan: PlanVO, cycle: BillCycle): string {
  const purchase = planPurchase(plan, cycle);
  if (!purchase.available || order.existingCheckout || order.paymentProcessing || order.status !== 0
    || order.market !== "en" || order.currency !== "USD" || order.payMethod !== "stripe"
    || order.checkoutAvailable !== true || order.planId !== plan.id || order.cycle !== cycle
    || order.amount !== purchase.total || order.credits !== purchase.credits) return "";
  return checkoutUrl(order);
}
