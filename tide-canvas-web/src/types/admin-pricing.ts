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
  /** true = 定价卡隐藏 CTA 按钮（默认展示）。 */
  hideCta: boolean;
  items: string[];
  sortOrder: number;
  /** 1 = 上架, 0 = 下架. */
  status: number;
  /** 购买授予的会员等级（0=不授予）；只能升级/重复购买拦截按它比较。 */
  vipLevel: number;
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
  /** 购买授予的会员等级（0=不授予）。Omit 保留既有值（批量排序回写不带它）。 */
  vipLevel?: number;
  /** 定价卡隐藏 CTA 按钮。Omit 保留既有值（上下架等部分回写不带它）。 */
  hideCta?: boolean;
}

/** 方案对比表的一行：能力名 + 每套餐一格（键=套餐 id；"✓"/"—"/文字）。 */
export interface AdminCompareRow {
  label: string;
  values: Record<string, string>;
}

/** GET/PUT /api/admin/pricing/compare 的文档体（billing.CompareVO 镜像）。 */
export interface AdminCompareVO {
  rows: AdminCompareRow[];
}

/** 定价页 FAQ 的一条问答。 */
export interface AdminFaqItem {
  q: string;
  a: string;
}

/** GET/PUT /api/admin/pricing/faq 的文档体（billing.FaqVO 镜像）。 */
export interface AdminFaqVO {
  items: AdminFaqItem[];
}

// 积分包（AdminPointPackage）类型已随管理功能一并移除：积分只随套餐发放。
