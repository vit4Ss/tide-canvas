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

/** Dashboard time series (trailing 14-day window, oldest first). */
export interface AdminChartsVO {
  userGrowth: ChartPoint[];
  postGrowth: ChartPoint[];
  orderGrowth: ChartPoint[];
  revenue: RevenuePoint[];
}
