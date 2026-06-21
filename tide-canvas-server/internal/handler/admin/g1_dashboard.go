// Package admin owns the admin-console route surface (mounted under /api/admin,
// already gated by JWTAuth + AdminOnly by the assemble step). Each group lives in
// its own g<N>_*.go file and exports a Register* func invoked from register.go.
//
// LINKAGE: admin sections read/write the SAME tables the user-facing pages use
// (users, community_post, market_model, order, point_record, ...) so admin edits
// are immediately visible on the front-end. No parallel admin-only copies.
package admin

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

// g1_dashboard.go backs the admin dashboard: an aggregate stats card block and
// time-series charts derived from the real domain tables. Everything is computed
// live via COUNT/SUM over user / community_post / market_model / order, so the
// numbers always reflect the current state of the linked user-facing data.

// g1OrderStatusPaid is the Order.Status value for a paid order (see model.Order:
// 0 待支付 / 1 已支付 / 2 已取消 / 3 已退款). Revenue/paying-user metrics count only paid.
// Prefixed to avoid clashing with other admin groups in the same package.
const g1OrderStatusPaid = 1

// g1DayFmt is the MySQL DATE_FORMAT spec that always yields a YYYY-MM-DD string,
// regardless of the driver's parseTime setting.
const g1DayFmt = "%Y-%m-%d"

// RegisterDashboard mounts the dashboard routes on the admin group.
//
//	GET /dashboard/stats  -> AdminStatsVO
//	GET /dashboard/charts -> AdminChartsVO
func RegisterDashboard(g *gin.RouterGroup, d *app.Deps) {
	h := &dashboardHandler{db: d.DB}
	g.GET("/dashboard/stats", h.stats)
	g.GET("/dashboard/charts", h.charts)
}

type dashboardHandler struct {
	db *gorm.DB
}

// AdminStatsVO is the aggregate stats block for the dashboard cards.
//
//	{totalUsers,todayNewUsers,activeUsers,payingUsers,totalPosts,totalModels,
//	 totalOrders,paidOrders,todayRevenue,totalRevenue}
type AdminStatsVO struct {
	TotalUsers    int64  `json:"totalUsers"`
	TodayNewUsers int64  `json:"todayNewUsers"`
	ActiveUsers   int64  `json:"activeUsers"`
	PayingUsers   int64  `json:"payingUsers"`
	TotalPosts    int64  `json:"totalPosts"`
	TotalModels   int64  `json:"totalModels"`
	TotalOrders   int64  `json:"totalOrders"`
	PaidOrders    int64  `json:"paidOrders"`
	TodayRevenue  string `json:"todayRevenue"`
	TotalRevenue  string `json:"totalRevenue"`
}

// stats handles GET /dashboard/stats. It aggregates over the real domain tables.
func (h *dashboardHandler) stats(c *gin.Context) {
	now := time.Now()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	active7d := now.AddDate(0, 0, -7)

	var vo AdminStatsVO

	// Users: total, today new (by create_time), active (logged in last 7 days).
	h.db.Model(&model.User{}).Count(&vo.TotalUsers)
	h.db.Model(&model.User{}).Where("create_time >= ?", startOfToday).Count(&vo.TodayNewUsers)
	h.db.Model(&model.User{}).Where("last_login_time >= ?", active7d).Count(&vo.ActiveUsers)

	// Paying users: distinct users with at least one paid order (status = 1).
	h.db.Model(&model.Order{}).
		Where("status = ?", g1OrderStatusPaid).
		Distinct("user_id").Count(&vo.PayingUsers)

	// Content / marketplace totals (same tables the user pages read).
	h.db.Model(&model.CommunityPost{}).Count(&vo.TotalPosts)
	h.db.Model(&model.MarketModel{}).Count(&vo.TotalModels)

	// Orders + revenue (paid orders only contribute to revenue).
	h.db.Model(&model.Order{}).Count(&vo.TotalOrders)
	h.db.Model(&model.Order{}).Where("status = ?", g1OrderStatusPaid).Count(&vo.PaidOrders)
	vo.TodayRevenue = h.sumPaidAmount("pay_time >= ?", startOfToday)
	vo.TotalRevenue = h.sumPaidAmount("", nil)

	response.OK(c, vo)
}

// sumPaidAmount sums the amount of paid orders, optionally constrained by an extra
// where clause. It returns the total as a fixed-2 decimal string ("0.00" when
// none). When extraWhere is empty the constraint is omitted.
func (h *dashboardHandler) sumPaidAmount(extraWhere string, arg any) string {
	tx := h.db.Model(&model.Order{}).Where("status = ?", g1OrderStatusPaid)
	if extraWhere != "" {
		tx = tx.Where(extraWhere, arg)
	}
	var sum decimal.Decimal
	// COALESCE so an all-NULL/empty set yields 0 rather than a scan error.
	row := tx.Select("COALESCE(SUM(amount), 0)").Row()
	if row != nil {
		_ = row.Scan(&sum)
	}
	return sum.StringFixed(2)
}

// AdminChartsVO carries the dashboard time series. Each point is a {date,count}
// pair; dates are YYYY-MM-DD over the trailing window (oldest first).
//
//	{userGrowth:[{date,count}],postGrowth:[{date,count}],orderGrowth:[{date,count}],revenue:[{date,amount}]}
type AdminChartsVO struct {
	UserGrowth  []ChartPoint   `json:"userGrowth"`
	PostGrowth  []ChartPoint   `json:"postGrowth"`
	OrderGrowth []ChartPoint   `json:"orderGrowth"`
	Revenue     []RevenuePoint `json:"revenue"`
}

// ChartPoint is a single {date,count} sample.
type ChartPoint struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// RevenuePoint is a single {date,amount} sample (amount as a fixed-2 string).
type RevenuePoint struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// g1ChartDays is the trailing window length for the dashboard trend series.
const g1ChartDays = 14

// charts handles GET /dashboard/charts. It builds last-14-day daily series for
// new users, new posts, new orders and paid revenue, derived from create_time /
// pay_time. Days with no data are returned as zero so the front-end renders a
// continuous axis.
func (h *dashboardHandler) charts(c *gin.Context) {
	now := time.Now()
	// Build the ordered list of day keys (oldest -> newest) and an index.
	days := make([]string, 0, g1ChartDays)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).
		AddDate(0, 0, -(g1ChartDays - 1))
	for i := 0; i < g1ChartDays; i++ {
		days = append(days, start.AddDate(0, 0, i).Format("2006-01-02"))
	}

	userCounts := h.dailyCounts(&model.User{}, "create_time", start)
	postCounts := h.dailyCounts(&model.CommunityPost{}, "create_time", start)
	orderCounts := h.dailyCounts(&model.Order{}, "create_time", start)
	revenueByDay := h.dailyRevenue(start)

	vo := AdminChartsVO{
		UserGrowth:  make([]ChartPoint, 0, g1ChartDays),
		PostGrowth:  make([]ChartPoint, 0, g1ChartDays),
		OrderGrowth: make([]ChartPoint, 0, g1ChartDays),
		Revenue:     make([]RevenuePoint, 0, g1ChartDays),
	}
	for _, day := range days {
		vo.UserGrowth = append(vo.UserGrowth, ChartPoint{Date: day, Count: userCounts[day]})
		vo.PostGrowth = append(vo.PostGrowth, ChartPoint{Date: day, Count: postCounts[day]})
		vo.OrderGrowth = append(vo.OrderGrowth, ChartPoint{Date: day, Count: orderCounts[day]})
		amount := revenueByDay[day]
		vo.Revenue = append(vo.Revenue, RevenuePoint{Date: day, Amount: amount.StringFixed(2)})
	}
	response.OK(c, vo)
}

// g1DayRow is the scan target for the grouped daily count aggregation. Day is a
// formatted YYYY-MM-DD string (via DATE_FORMAT) so the scan is driver-agnostic.
type g1DayRow struct {
	Day string `gorm:"column:day"`
	N   int64  `gorm:"column:n"`
}

// g1RevRow is the scan target for the grouped daily revenue aggregation.
type g1RevRow struct {
	Day    string          `gorm:"column:day"`
	Amount decimal.Decimal `gorm:"column:amount"`
}

// dailyCounts returns a map of YYYY-MM-DD -> row count for the given model,
// grouped by the date portion of dateCol, from `since` onward. DATE_FORMAT yields
// a string key regardless of the MySQL driver's parseTime setting.
func (h *dashboardHandler) dailyCounts(m any, dateCol string, since time.Time) map[string]int64 {
	out := map[string]int64{}
	var rows []g1DayRow
	err := h.db.Model(m).
		Select("DATE_FORMAT("+dateCol+", ?) AS day, COUNT(*) AS n", g1DayFmt).
		Where(dateCol+" >= ?", since).
		Group("day").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Day] = rows[i].N
	}
	return out
}

// dailyRevenue returns a map of YYYY-MM-DD -> summed paid amount, grouped by the
// date portion of pay_time, from `since` onward (paid orders only).
func (h *dashboardHandler) dailyRevenue(since time.Time) map[string]decimal.Decimal {
	out := map[string]decimal.Decimal{}
	var rows []g1RevRow
	err := h.db.Model(&model.Order{}).
		Select("DATE_FORMAT(pay_time, ?) AS day, COALESCE(SUM(amount), 0) AS amount", g1DayFmt).
		Where("status = ? AND pay_time >= ?", g1OrderStatusPaid, since).
		Group("day").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Day] = rows[i].Amount
	}
	return out
}
