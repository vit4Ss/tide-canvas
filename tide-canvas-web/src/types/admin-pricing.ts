// ============================================================================
// Admin · 价格管理 (Pricing) — TS shapes mirroring the Go admin handler VOs/DTOs
// in internal/handler/admin/g4_pricing.go.
//
// NOTE: idgen.ID marshals to a QUOTED decimal string in JSON (see
// idgen.MarshalJSON → `"123"`), so every id field is a TS `string`.
// ============================================================================

/** g4PlanVO — admin plan-row view (mirrors the public pricing card + admin extras). */
export interface AdminPlan {
  id: string;
  name: string;
  code: string;
  desc: string;
  /** Monthly price (maps to Plan.Price). */
  monthly: number;
  yearly: number;
  monthlyPoints: number;
  featured: boolean;
  cta: string;
  items: string[];
  sortOrder: number;
  /** 1 = 上架, 0 = 下架. */
  status: number;
  createTime: string;
  updateTime: string;
}

/** g4PlanUpsertDTO — create/update body for a plan. */
export interface AdminPlanUpsertDTO {
  name: string;
  code?: string;
  desc?: string;
  monthly?: number;
  yearly?: number;
  monthlyPoints?: number;
  featured?: boolean;
  cta?: string;
  items?: string[];
  sortOrder?: number;
  /** Omit to default to 1 (上架) on create / preserve on update. */
  status?: number;
}

/** g4PointPackageVO — admin point-package row view. */
export interface AdminPointPackage {
  id: string;
  name: string;
  points: number;
  bonusPoints: number;
  price: number;
  sortOrder: number;
  /** 1 = 上架, 0 = 下架. */
  status: number;
  createTime: string;
  updateTime: string;
}

/** g4PointPackageUpsertDTO — create/update body for a point package. */
export interface AdminPointPackageUpsertDTO {
  name: string;
  points?: number;
  bonusPoints?: number;
  price?: number;
  sortOrder?: number;
  status?: number;
}
