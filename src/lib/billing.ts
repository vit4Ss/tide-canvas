import type { PlanVO, BillCycle } from "@/types/billing";
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
