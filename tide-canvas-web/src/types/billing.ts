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
