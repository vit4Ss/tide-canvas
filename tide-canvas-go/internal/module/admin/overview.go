package admin

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// 趋势图天数(含今天) 与 AI 调用分布 Top 数（对齐 AdminDashboardController.TREND_DAYS / DISTRIBUTION_TOP）。
const (
	trendDays       = 7
	distributionTop = 5
	dayLabelLayout  = "01/02" // MM/dd（对齐 DAY_LABEL）
	keyDateLayout   = "2006-01-02"
)

// OverviewService 数据面板服务（忠实迁移 AdminDashboardController）。
// 各聚合查询包一层容错：迁移前 access_log/login_log 等可能为空或聚合失败，单项失败回退 0/空，不影响整体面板。
type OverviewService struct {
	repo   *Repository
	logger *logrus.Logger
}

// NewOverviewService 构造。logger 可为 nil。
func NewOverviewService(repo *Repository, logger *logrus.Logger) *OverviewService {
	return &OverviewService{repo: repo, logger: logger}
}

// Overview 数据概览（对齐 overview）。
func (s *OverviewService) Overview() *DashboardOverviewVO {
	vo := &DashboardOverviewVO{}
	vo.TotalUsers = s.safeCount("统计用户总数", func() (int64, error) { return s.repo.CountAll(&model.SysUser{}) })
	vo.TotalProjects = s.safeCount("统计项目总数", func() (int64, error) { return s.repo.CountAll(&model.CanvasProject{}) })
	vo.TotalApiCalls = s.safeCount("统计AI调用总数", func() (int64, error) { return s.repo.CountAll(&model.AiTask{}) })
	vo.TodayNewUsers = s.safeCount("查询今日新增用户", func() (int64, error) { return s.repo.CountTodayByColumn(&model.SysUser{}, "create_time") })
	vo.ActiveUsers = s.safeCount("查询活跃用户", s.repo.CountTodayActiveUsers)
	vo.TodayApiCalls = s.safeCount("查询今日API调用", func() (int64, error) { return s.repo.CountTodayByColumn(&model.AiTask{}, "create_time") })
	vo.TodayNewProjects = s.safeCount("查询今日新建项目", func() (int64, error) { return s.repo.CountTodayByColumn(&model.CanvasProject{}, "create_time") })
	vo.TotalStorageBytes = s.safeCount("查询总存储量", s.repo.SumTotalStorage)
	vo.TodayVisits = s.safeCount("查询今日访问量(PV)", s.repo.CountTodayPv)
	vo.TodayVisitors = s.safeCount("查询今日独立访客(UV)", s.repo.CountTodayUv)
	vo.TodayLogins = s.safeCount("查询今日登录数", s.repo.CountTodayLogins)

	today := startOfToday()
	vo.ActiveWeek = s.safeCount("查询活跃用户(周)", func() (int64, error) { return s.repo.CountActiveSince(today.AddDate(0, 0, -6)) })
	vo.ActiveMonth = s.safeCount("查询活跃用户(月)", func() (int64, error) { return s.repo.CountActiveSince(today.AddDate(0, 0, -29)) })
	return vo
}

// Charts 图表数据（近7天趋势 / AI 调用分布 / 模型排行 / 访问 / 登录，对齐 charts）。
func (s *OverviewService) Charts() *DashboardChartsVO {
	today := startOfToday()
	startDay := today.AddDate(0, 0, -(trendDays - 1))
	start := startDay
	end := endOfDay(today)

	newUsersByDay := s.safeDateCountMap("近7天新增用户", func() ([]dateCountRow, error) { return s.repo.CountByDateRange(&model.SysUser{}, start, end) })
	activeUsersByDay := s.safeDateCountMap("近7天活跃用户", func() ([]dateCountRow, error) { return s.repo.CountActiveUsersByDateRange(start, end) })
	projectsByDay := s.safeDateCountMap("近7天项目创建", func() ([]dateCountRow, error) { return s.repo.CountByDateRange(&model.CanvasProject{}, start, end) })
	aiCallsByDay := s.safeDateCountMap("近7天AI调用", func() ([]dateCountRow, error) { return s.repo.CountByDateRange(&model.AiTask{}, start, end) })
	pvByDay := s.safeDateCountMap("近7天PV", func() ([]dateCountRow, error) { return s.repo.PvByDateRange(start, end) })
	uvByDay := s.safeDateCountMap("近7天UV", func() ([]dateCountRow, error) { return s.repo.UvByDateRange(start, end) })
	loginByDay := s.safeDateCountMap("近7天登录", func() ([]dateCountRow, error) { return s.repo.LoginByDateRange(start, end) })

	// 逐日补零，保证图表横轴连续（对齐 charts 的循环）
	userTrend := make([]DailyTrendVO, 0, trendDays)
	dailyCreation := make([]DailyCreationVO, 0, trendDays)
	visitTrend := make([]DailyVisitVO, 0, trendDays)
	loginTrend := make([]DailyCountVO, 0, trendDays)
	for i := 0; i < trendDays; i++ {
		day := startDay.AddDate(0, 0, i)
		key := day.Format(keyDateLayout)
		label := day.Format(dayLabelLayout)
		userTrend = append(userTrend, DailyTrendVO{Date: label, NewUsers: newUsersByDay[key], ActiveUsers: activeUsersByDay[key]})
		dailyCreation = append(dailyCreation, DailyCreationVO{Date: label, Projects: projectsByDay[key], AiCalls: aiCallsByDay[key]})
		visitTrend = append(visitTrend, DailyVisitVO{Date: label, PV: pvByDay[key], UV: uvByDay[key]})
		loginTrend = append(loginTrend, DailyCountVO{Date: label, Count: loginByDay[key]})
	}

	return &DashboardChartsVO{
		UserTrend:      userTrend,
		AiDistribution: s.buildAiDistribution(),
		DailyCreation:  dailyCreation,
		ModelUsage:     s.buildModelUsage(),
		VisitTrend:     visitTrend,
		LoginTrend:     loginTrend,
	}
}

// ActiveUsers 最近活跃用户（对齐 activeUsers，固定取10条）。
func (s *OverviewService) ActiveUsers() []ActiveUserVO {
	users, err := s.repo.SelectActiveUsers(10)
	if err != nil {
		s.logWarnf("查询活跃用户列表失败: %v", err)
		return []ActiveUserVO{}
	}
	out := make([]ActiveUserVO, 0, len(users))
	for i := range users {
		u := &users[i]
		out = append(out, ActiveUserVO{
			ID:            u.PublicID,
			Username:      u.Username,
			Nickname:      u.Nickname,
			Avatar:        u.Avatar,
			Points:        u.Points,
			LastLoginTime: u.LastLoginTime,
		})
	}
	return out
}

// buildAiDistribution AI 调用分布：handler 标识映射后台配置显示名，Top5 之外合并为“其他”（对齐 buildAiDistribution）。
func (s *OverviewService) buildAiDistribution() []NameValueVO {
	displayNames, err := s.repo.HandlerDisplayNames()
	if err != nil {
		s.logWarnf("查询Handler显示名失败: %v", err)
		displayNames = map[string]string{}
	}
	rows, err := s.repo.CountByHandler()
	if err != nil {
		s.logWarnf("查询AI调用分布失败: %v", err)
		return []NameValueVO{}
	}
	result := make([]NameValueVO, 0, distributionTop+1)
	var others int64
	for i := range rows {
		handler := rows[i].Name
		count := rows[i].Value
		if i < distributionTop {
			name := handler
			if dn, ok := displayNames[handler]; ok {
				name = dn
			}
			result = append(result, NameValueVO{Name: name, Value: count})
		} else {
			others += count
		}
	}
	if others > 0 {
		result = append(result, NameValueVO{Name: "其他", Value: others})
	}
	return result
}

// buildModelUsage 模型使用排行 Top5（对齐 buildModelUsage）。
func (s *OverviewService) buildModelUsage() []NameValueVO {
	rows, err := s.repo.ModelUsageRank(5)
	if err != nil {
		s.logWarnf("查询模型使用排行失败: %v", err)
		return []NameValueVO{}
	}
	out := make([]NameValueVO, 0, len(rows))
	for i := range rows {
		name := blankToDefault(rows[i].Name, "未知模型")
		out = append(out, NameValueVO{Name: name, Value: rows[i].Value})
	}
	return out
}

// safeCount 执行计数查询，失败回退 0 并打日志（对齐 overview 中每项的 try/catch）。
func (s *OverviewService) safeCount(desc string, fn func() (int64, error)) int64 {
	n, err := fn()
	if err != nil {
		s.logWarnf("%s失败: %v", desc, err)
		return 0
	}
	return n
}

// safeDateCountMap 执行逐日聚合并转为 map，失败回退空 map（对齐 safeDateCountMap / toDateCountMap）。
func (s *OverviewService) safeDateCountMap(desc string, fn func() ([]dateCountRow, error)) map[string]int64 {
	rows, err := fn()
	if err != nil {
		s.logWarnf("%s失败: %v", desc, err)
		return map[string]int64{}
	}
	m := make(map[string]int64, len(rows))
	for i := range rows {
		if rows[i].Date == "" {
			continue
		}
		// DATE() 列在不同驱动下可能返回 time 或 string，统一规整为 yyyy-MM-dd 键
		m[normalizeDateKey(rows[i].Date)] += rows[i].Count
	}
	return m
}

func (s *OverviewService) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// normalizeDateKey 规整日期键：取前 10 位（yyyy-MM-dd），兼容 "2006-01-02" 或 "2006-01-02T..." 形式。
func normalizeDateKey(s string) string {
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

// startOfToday 今日零点（本地时区，对齐 LocalDate.now()）。
func startOfToday() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
}

// endOfDay 当日 23:59:59（对齐 today + " 23:59:59"）。
func endOfDay(day time.Time) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), 23, 59, 59, 0, time.Local)
}

// ---- HTTP handlers（挂载于 /api/admin/dashboard，已 JWTAuth + AdminOnly）----

// overview GET /api/admin/dashboard/overview 数据概览。
func (h *Handler) overview(c *gin.Context) {
	response.OK(c, h.overviewSvc.Overview())
}

// charts GET /api/admin/dashboard/charts 图表数据。
func (h *Handler) charts(c *gin.Context) {
	response.OK(c, h.overviewSvc.Charts())
}

// dashboardActiveUsers GET /api/admin/dashboard/active-users 最近活跃用户。
func (h *Handler) dashboardActiveUsers(c *gin.Context) {
	response.OK(c, h.overviewSvc.ActiveUsers())
}
