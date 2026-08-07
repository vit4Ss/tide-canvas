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
//	GET /dashboard/stats        -> AdminStatsVO
//	GET /dashboard/charts       -> AdminChartsVO
//	GET /dashboard/points/today -> TodayPointConsumptionVO
func RegisterDashboard(g *gin.RouterGroup, d *app.Deps) {
	h := &dashboardHandler{db: d.DB}
	g.GET("/dashboard/stats", h.stats)
	g.GET("/dashboard/charts", h.charts)
	g.GET("/dashboard/points/today", h.todayPointConsumption)
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
	// 只数已发布：用户生成的作品一律先落「未发布」，把它们算进来会让概览的
	// 作品数远大于广场上实际能看到的内容。
	h.db.Model(&model.CommunityPost{}).Where("status = ?", 1).Count(&vo.TotalPosts)
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
//	{userGrowth:[{date,count}],postGrowth:[{date,count}],orderGrowth:[{date,count}],
//	 revenue:[{date,amount}],modelCalls:[{date,count,success}],modelTop:[{model,count,success,avgMs}]}
type AdminChartsVO struct {
	UserGrowth  []ChartPoint   `json:"userGrowth"`
	PostGrowth  []ChartPoint   `json:"postGrowth"`
	OrderGrowth []ChartPoint   `json:"orderGrowth"`
	Revenue     []RevenuePoint `json:"revenue"`
	// ModelCalls：近 14 天模型调用量/成功量（model_call_log 真实用户调用；
	// 可用性探测在独立的 model_probe 表，不计入）。
	ModelCalls []ModelCallPoint `json:"modelCalls"`
	// ModelTop：近 14 天调用量 Top5 模型（含成功量与平均耗时）。
	ModelTop []ModelTopVO `json:"modelTop"`
	// PointConsumption / point leaderboards use the real point ledger and the
	// point_cost stamped on model_call_log over the same trailing window.
	PointSummary           PointSummaryVO             `json:"pointSummary"`
	PointConsumption       []PointConsumptionPoint    `json:"pointConsumption"`
	PointUserTop           []PointUserTopVO           `json:"pointUserTop"`
	PointModelTop          []PointModelTopVO          `json:"pointModelTop"`
	RecentPointConsumption []RecentPointConsumptionVO `json:"recentPointConsumption"`
}

// PointSummaryVO is the gross consume-ledger summary for the dashboard window.
// Refunds remain separate positive ledger rows and are intentionally not folded
// into consumption activity.
type PointSummaryVO struct {
	TodayPoints   int64 `json:"todayPoints"`
	PeriodPoints  int64 `json:"periodPoints"`
	PeriodUsers   int64 `json:"periodUsers"`
	PeriodRecords int64 `json:"periodRecords"`
}

// TodayPointConsumptionVO is intentionally small so the dashboard can refresh
// its live KPI without repeatedly loading all 14-day charts and rankings.
type TodayPointConsumptionVO struct {
	Points int64     `json:"points"`
	AsOf   time.Time `json:"asOf"`
}

type PointConsumptionPoint struct {
	Date    string `json:"date"`
	Points  int64  `json:"points"`
	Users   int64  `json:"users"`
	Records int64  `json:"records"`
}

type PointUserTopVO struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Points   int64  `json:"points"`
	Records  int64  `json:"records"`
	LastTime string `json:"lastTime"`
}

type PointModelTopVO struct {
	Model     string `json:"model"`
	ModelName string `json:"modelName"`
	Points    int64  `json:"points"`
	Calls     int64  `json:"calls"`
	Users     int64  `json:"users"`
	Success   int64  `json:"success"`
}

type RecentPointConsumptionVO struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	Username   string `json:"username"`
	Nickname   string `json:"nickname"`
	Points     int64  `json:"points"`
	Balance    int64  `json:"balance"`
	Remark     string `json:"remark"`
	CreateTime string `json:"createTime"`
}

// ModelCallPoint is a single {date,count,success} sample of model calls.
type ModelCallPoint struct {
	Date    string `json:"date"`
	Count   int64  `json:"count"`
	Success int64  `json:"success"`
}

// ModelTopVO is one row of the model-call leaderboard.
type ModelTopVO struct {
	Model     string `json:"model"`
	ModelName string `json:"modelName"` // 目录显示名,查不到为空→前端回退 key
	Count     int64  `json:"count"`
	Success   int64  `json:"success"`
	AvgMs     int64  `json:"avgMs"`
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
	callsByDay := h.dailyModelCalls(start)
	pointByDay := h.dailyPointConsumption(start)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	vo := AdminChartsVO{
		UserGrowth:             make([]ChartPoint, 0, g1ChartDays),
		PostGrowth:             make([]ChartPoint, 0, g1ChartDays),
		OrderGrowth:            make([]ChartPoint, 0, g1ChartDays),
		Revenue:                make([]RevenuePoint, 0, g1ChartDays),
		ModelCalls:             make([]ModelCallPoint, 0, g1ChartDays),
		ModelTop:               h.topModelCalls(start, 5),
		PointSummary:           h.pointSummary(start, startOfToday),
		PointConsumption:       make([]PointConsumptionPoint, 0, g1ChartDays),
		PointUserTop:           h.topPointUsers(start, 8),
		PointModelTop:          h.topPointModels(start, 8),
		RecentPointConsumption: h.recentPointConsumption(10),
	}
	for _, day := range days {
		vo.UserGrowth = append(vo.UserGrowth, ChartPoint{Date: day, Count: userCounts[day]})
		vo.PostGrowth = append(vo.PostGrowth, ChartPoint{Date: day, Count: postCounts[day]})
		vo.OrderGrowth = append(vo.OrderGrowth, ChartPoint{Date: day, Count: orderCounts[day]})
		amount := revenueByDay[day]
		vo.Revenue = append(vo.Revenue, RevenuePoint{Date: day, Amount: amount.StringFixed(2)})
		call := callsByDay[day]
		vo.ModelCalls = append(vo.ModelCalls, ModelCallPoint{Date: day, Count: call.N, Success: call.OkN})
		point := pointByDay[day]
		vo.PointConsumption = append(vo.PointConsumption, PointConsumptionPoint{
			Date: day, Points: point.Points, Users: point.Users, Records: point.Records,
		})
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

// g1CallRow is the scan target for the grouped daily model-call aggregation.
type g1CallRow struct {
	Day string `gorm:"column:day"`
	N   int64  `gorm:"column:n"`
	OkN int64  `gorm:"column:okn"`
}

// dailyModelCalls returns a map of YYYY-MM-DD -> {calls, successes} over
// model_call_log（真实用户调用：chat/optimize/image/video）from `since` onward.
func (h *dashboardHandler) dailyModelCalls(since time.Time) map[string]g1CallRow {
	out := map[string]g1CallRow{}
	var rows []g1CallRow
	err := h.db.Model(&model.ModelCallLog{}).
		Select("DATE_FORMAT(create_time, ?) AS day, COUNT(*) AS n, COALESCE(SUM(success), 0) AS okn", g1DayFmt).
		Where("create_time >= ?", since).
		Group("day").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Day] = rows[i]
	}
	return out
}

// topModelCalls returns the most-called models since the cut-off, with success
// counts and average duration.
func (h *dashboardHandler) topModelCalls(since time.Time, limit int) []ModelTopVO {
	var rows []struct {
		Model string `gorm:"column:model"`
		N     int64  `gorm:"column:n"`
		OkN   int64  `gorm:"column:okn"`
		AvgMs int64  `gorm:"column:avg_ms"`
	}
	out := []ModelTopVO{}
	// AVG 返回带小数的 DECIMAL，直接扫 int64 会整查询报错——ROUND+CAST 落整。
	err := h.db.Model(&model.ModelCallLog{}).
		Select("model, COUNT(*) AS n, COALESCE(SUM(success), 0) AS okn, "+
			"CAST(COALESCE(ROUND(AVG(duration_ms)), 0) AS SIGNED) AS avg_ms").
		Where("create_time >= ? AND model <> ''", since).
		Group("model").
		Order("n DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return out
	}
	keys := make([]string, 0, len(rows))
	for i := range rows {
		keys = append(keys, rows[i].Model)
	}
	names := resolveModelNames(h.db, keys)
	for i := range rows {
		out = append(out, ModelTopVO{
			Model:     rows[i].Model,
			ModelName: names[rows[i].Model],
			Count:     rows[i].N,
			Success:   rows[i].OkN,
			AvgMs:     rows[i].AvgMs,
		})
	}
	return out
}

type g1PointDailyRow struct {
	Day     string `gorm:"column:day"`
	Points  int64  `gorm:"column:points"`
	Users   int64  `gorm:"column:users"`
	Records int64  `gorm:"column:records"`
}

func pointConsumeScope(db *gorm.DB, since time.Time) *gorm.DB {
	return db.Model(&model.PointRecord{}).
		Where("create_time >= ? AND change_type = ? AND amount < 0", since, "consume")
}

func (h *dashboardHandler) todayPointConsumption(c *gin.Context) {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var row struct {
		Points int64 `gorm:"column:points"`
	}
	if err := pointConsumeScope(h.db, today).
		Select("COALESCE(SUM(-amount), 0) AS points").
		Scan(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load today's point consumption")
		return
	}
	response.OK(c, TodayPointConsumptionVO{Points: row.Points, AsOf: now})
}

func (h *dashboardHandler) dailyPointConsumption(since time.Time) map[string]g1PointDailyRow {
	out := map[string]g1PointDailyRow{}
	var rows []g1PointDailyRow
	err := pointConsumeScope(h.db, since).
		Select("DATE_FORMAT(create_time, ?) AS day, COALESCE(SUM(-amount), 0) AS points, "+
			"COUNT(DISTINCT user_id) AS users, COUNT(*) AS records", g1DayFmt).
		Group("day").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Day] = rows[i]
	}
	return out
}

func (h *dashboardHandler) pointSummary(since, today time.Time) PointSummaryVO {
	var row struct {
		TodayPoints   int64 `gorm:"column:today_points"`
		PeriodPoints  int64 `gorm:"column:period_points"`
		PeriodUsers   int64 `gorm:"column:period_users"`
		PeriodRecords int64 `gorm:"column:period_records"`
	}
	_ = pointConsumeScope(h.db, since).
		Select("COALESCE(SUM(CASE WHEN create_time >= ? THEN -amount ELSE 0 END), 0) AS today_points, "+
			"COALESCE(SUM(-amount), 0) AS period_points, COUNT(DISTINCT user_id) AS period_users, "+
			"COUNT(*) AS period_records", today).
		Scan(&row).Error
	return PointSummaryVO(row)
}

func (h *dashboardHandler) topPointUsers(since time.Time, limit int) []PointUserTopVO {
	rows := []PointUserTopVO{}
	err := h.db.Table("point_record AS pr").
		Select("CAST(pr.user_id AS CHAR) AS user_id, COALESCE(u.username, '') AS username, "+
			"COALESCE(u.nickname, '') AS nickname, COALESCE(SUM(-pr.amount), 0) AS points, "+
			"COUNT(*) AS records, MAX(pr.create_time) AS last_time").
		Joins("LEFT JOIN users AS u ON u.id = pr.user_id AND u.deleted IS NULL").
		Where("pr.deleted IS NULL AND pr.create_time >= ? AND pr.change_type = ? AND pr.amount < 0", since, "consume").
		Group("pr.user_id, u.username, u.nickname").
		Order("points DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return []PointUserTopVO{}
	}
	return rows
}

func (h *dashboardHandler) topPointModels(since time.Time, limit int) []PointModelTopVO {
	var rows []struct {
		Model   string `gorm:"column:model"`
		Points  int64  `gorm:"column:points"`
		Calls   int64  `gorm:"column:calls"`
		Users   int64  `gorm:"column:users"`
		Success int64  `gorm:"column:success"`
	}
	err := h.db.Model(&model.ModelCallLog{}).
		Select("model, COALESCE(SUM(point_cost), 0) AS points, COUNT(*) AS calls, "+
			"COUNT(DISTINCT user_id) AS users, COALESCE(SUM(success), 0) AS success").
		Where("create_time >= ? AND point_cost > 0 AND model <> ''", since).
		Group("model").
		Order("points DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return []PointModelTopVO{}
	}
	keys := make([]string, 0, len(rows))
	for i := range rows {
		keys = append(keys, rows[i].Model)
	}
	names := resolveModelNames(h.db, keys)
	out := make([]PointModelTopVO, 0, len(rows))
	for i := range rows {
		out = append(out, PointModelTopVO{
			Model: rows[i].Model, ModelName: names[rows[i].Model], Points: rows[i].Points,
			Calls: rows[i].Calls, Users: rows[i].Users, Success: rows[i].Success,
		})
	}
	return out
}

func (h *dashboardHandler) recentPointConsumption(limit int) []RecentPointConsumptionVO {
	rows := []RecentPointConsumptionVO{}
	err := h.db.Table("point_record AS pr").
		Select("CAST(pr.id AS CHAR) AS id, CAST(pr.user_id AS CHAR) AS user_id, "+
			"COALESCE(u.username, '') AS username, COALESCE(u.nickname, '') AS nickname, "+
			"-pr.amount AS points, pr.balance, pr.remark, pr.create_time").
		Joins("LEFT JOIN users AS u ON u.id = pr.user_id AND u.deleted IS NULL").
		Where("pr.deleted IS NULL AND pr.change_type = ? AND pr.amount < 0", "consume").
		Order("pr.create_time DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return []RecentPointConsumptionVO{}
	}
	return rows
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
