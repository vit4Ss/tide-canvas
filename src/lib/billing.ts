import type { PlanVO, BillCycle } from "@/types/billing";
export function planPurchase(plan: PlanVO, cycle: BillCycle) {
  const monthlyEquivalent = Number(cycle === "monthly" ? plan.promo?.monthly || plan.monthly : plan.promo?.yearly || plan.yearly);
  return {
    monthlyEquivalent,
    total: monthlyEquivalent * (cycle === "yearly" ? 12 : 1),
    credits: plan.monthlyPoints * (cycle === "yearly" ? 12 : 1),
    available: cycle !== "yearly" || Number(plan.monthly) === 0 || monthlyEquivalent > 0,
  };
}
