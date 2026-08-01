// ============================================================================
// Admin dashboard (g1_dashboard.go) wire types.
//
// Mirrors the backend VOs in
//   tide-canvas-server/internal/handler/admin/g1_dashboard.go
//   GET /api/admin/dashboard/stats  -> AdminStatsVO
//   GET /api/admin/dashboard/charts -> AdminChartsVO
//
// Monetary fields (todayRevenue/totalRevenue/RevenuePoint.amount) arrive as
// fixed-2 decimal STRINGS ("0.00"); counts are numbers.
// ============================================================================

/** Aggregate stats block for the dashboard KPI cards. */
export interface AdminStatsVO {
  totalUsers: number;
  todayNewUsers: number;
  activeUsers: number;
  payingUsers: number;
  totalPosts: number;
  totalModels: number;
  totalOrders: number;
  paidOrders: number;
  /** fixed-2 decimal string, e.g. "0.00". */
  todayRevenue: string;
  /** fixed-2 decimal string, e.g. "0.00". */
  totalRevenue: string;
}

/** A single {date,count} sample (YYYY-MM-DD). */
export interface ChartPoint {
  date: string;
  count: number;
}

/** A single {date,amount} sample (amount as a fixed-2 string). */
export interface RevenuePoint {
  date: string;
  amount: string;
}

/** A single {date,count,success} model-call sample (YYYY-MM-DD). */
export interface ModelCallPoint {
  date: string;
  count: number;
  success: number;
}

/** One row of the model-call leaderboard (近 14 天). */
export interface ModelTopVO {
  model: string;
  /** 目录显示名;查不到为空 → 展示回退 model */
  modelName: string;
  count: number;
  success: number;
  avgMs: number;
}

/** Dashboard time series (trailing 14-day window, oldest first). */
export interface AdminChartsVO {
  userGrowth: ChartPoint[];
  postGrowth: ChartPoint[];
  orderGrowth: ChartPoint[];
  revenue: RevenuePoint[];
  /** 近 14 天模型调用（model_call_log 真实用户调用；探测样本不计入） */
  modelCalls: ModelCallPoint[];
  /** 近 14 天调用量 Top5 模型 */
  modelTop: ModelTopVO[];
}
