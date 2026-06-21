import { http } from "@/lib/http";
import type { PlanVO, PointPackageVO } from "@/types/billing";

/**
 * Billing API — public reads of pricing plans and point-package bundles.
 * Mirrors tide-canvas-server/internal/handler/billing. Both endpoints are
 * public (no auth/session required).
 */
export const billingApi = {
  plans: () => http.get<PlanVO[]>("/api/billing/plans"),
  packages: () => http.get<PointPackageVO[]>("/api/billing/packages"),
};
