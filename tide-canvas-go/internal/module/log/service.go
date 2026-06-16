package log

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// 访问趋势天数（含今天）与日期键格式。
const (
	statsTrendDays = 7
	keyDateLayout  = "2006-01-02"
)

// Service 日志业务：管理端查询/删除 + PV/UV 统计 + 操作日志写入（RecordOperation）。
type Service struct {
	repo   *Repository
	logger *logrus.Logger
}

// NewService 构造。logger 可为 nil。
func NewService(repo *Repository, logger *logrus.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// =====================================================================
// 操作日志写入（供其他模块调用，对齐 OperateLogAspect）
// =====================================================================

// RecordOperation 记录一条操作日志（写 sys_log），供其他模块在敏感操作后调用。
//
// 对齐旧 @OperateLog 切面：从上下文取当前用户与客户端 IP，异步落库；写入失败仅告警，
// 绝不影响业务请求本身（对齐切面的 try/catch）。c 可为 nil（无请求上下文时仅记录 action/target/detail）。
func (s *Service) RecordOperation(c *gin.Context, action, target, detail string) {
	entry := &model.SysLog{
		Action: action,
		Target: target,
		Detail: detail,
	}
	if c != nil {
		if uid, ok := middleware.CurrentUserID(c); ok {
			entry.UserID = &uid
		}
		if v, ok := c.Get("currentUsername"); ok {
			if username, ok := v.(string); ok {
				entry.Username = username
			}
		}
		entry.IP = middleware.ClientIP(c)
	}
	go s.saveOperation(entry)
}

// saveOperation 异步写操作日志；失败仅告警（对齐 OperateLogAspect 的 try/catch）。
func (s *Service) saveOperation(entry *model.SysLog) {
	defer func() {
		if r := recover(); r != nil {
			s.logWarnf("记录操作日志 panic: %v", r)
		}
	}()
	if err := s.repo.InsertSysLog(entry); err != nil {
		s.logWarnf("记录操作日志失败: %v", err)
	}
}

// =====================================================================
// 管理端查询
// =====================================================================

// ListAccessLogs 访问日志分页（对齐 AdminAccessLogController.list）。
func (s *Service) ListAccessLogs(q *AccessLogQuery) ([]AccessLogVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageAccessLogs(q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]AccessLogVO, 0, len(records))
	for i := range records {
		out = append(out, toAccessLogVO(&records[i]))
	}
	return out, total, nil
}

// ListLoginLogs 登录日志分页（对齐 AdminLoginLogController.list）。
func (s *Service) ListLoginLogs(q *LoginLogQuery) ([]LoginLogVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageLoginLogs(q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]LoginLogVO, 0, len(records))
	for i := range records {
		out = append(out, toLoginLogVO(&records[i]))
	}
	return out, total, nil
}

// ListSysLogs 操作日志分页（对齐 AdminLogController.list）。
func (s *Service) ListSysLogs(q *SysLogQuery) ([]SysLogVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageSysLogs(q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]SysLogVO, 0, len(records))
	for i := range records {
		out = append(out, toSysLogVO(&records[i]))
	}
	return out, total, nil
}

// DeleteAccessLog 删除一条访问日志（对齐 AdminAccessLogController.delete）。
func (s *Service) DeleteAccessLog(id int64) error { return s.repo.DeleteAccessLog(id) }

// DeleteLoginLog 删除一条登录日志（对齐 AdminLoginLogController.delete）。
func (s *Service) DeleteLoginLog(id int64) error { return s.repo.DeleteLoginLog(id) }

// DeleteSysLog 删除一条操作日志（对齐 AdminLogController.delete）。
func (s *Service) DeleteSysLog(id int64) error { return s.repo.DeleteSysLog(id) }

// =====================================================================
// 统计（PV / UV / 登录）
// =====================================================================

// Stats 访问统计：今日 PV/UV/登录 + 近 7 天 PV/UV 趋势（聚合 AccessLogMapper 的统计能力）。
// 各聚合查询单独容错：迁移初期 access_log/login_log 可能为空或聚合失败，单项失败回退 0/空，不影响整体。
func (s *Service) Stats() *LogStatsVO {
	vo := &LogStatsVO{
		TodayPv:    s.safeCount("查询今日PV", s.repo.CountTodayPv),
		TodayUv:    s.safeCount("查询今日UV", s.repo.CountTodayUv),
		TodayLogin: s.safeCount("查询今日登录数", s.repo.CountTodayLogins),
	}

	today := startOfToday()
	startDay := today.AddDate(0, 0, -(statsTrendDays - 1))
	start := startDay
	end := endOfDay(today)

	pvByDay := s.safeDateCountMap("近7天PV", func() ([]dateCountRow, error) { return s.repo.PvByDateRange(start, end) })
	uvByDay := s.safeDateCountMap("近7天UV", func() ([]dateCountRow, error) { return s.repo.UvByDateRange(start, end) })

	trend := make([]DailyVisitVO, 0, statsTrendDays)
	for i := 0; i < statsTrendDays; i++ {
		day := startDay.AddDate(0, 0, i)
		key := day.Format(keyDateLayout)
		trend = append(trend, DailyVisitVO{Date: key, PV: pvByDay[key], UV: uvByDay[key]})
	}
	vo.VisitTrend = trend
	return vo
}

// safeCount 执行计数查询，失败回退 0 并告警。
func (s *Service) safeCount(desc string, fn func() (int64, error)) int64 {
	n, err := fn()
	if err != nil {
		s.logWarnf("%s失败: %v", desc, err)
		return 0
	}
	return n
}

// safeDateCountMap 执行逐日聚合并转为 map（键 yyyy-MM-dd），失败回退空 map。
func (s *Service) safeDateCountMap(desc string, fn func() ([]dateCountRow, error)) map[string]int64 {
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

func (s *Service) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// ---- VO 转换 ----

func toAccessLogVO(l *model.AccessLog) AccessLogVO {
	return AccessLogVO{
		ID:         l.ID,
		UserID:     l.UserID,
		Username:   l.Username,
		Method:     l.Method,
		Path:       l.Path,
		Query:      l.Query,
		Status:     l.Status,
		DurationMs: l.DurationMs,
		IP:         l.IP,
		UserAgent:  l.UserAgent,
		CreateTime: l.CreateTime,
	}
}

func toLoginLogVO(l *model.LoginLog) LoginLogVO {
	return LoginLogVO{
		ID:         l.ID,
		UserID:     l.UserID,
		Username:   l.Username,
		Status:     l.Status,
		FailReason: l.FailReason,
		IP:         l.IP,
		UserAgent:  l.UserAgent,
		CreateTime: l.CreateTime,
	}
}

func toSysLogVO(l *model.SysLog) SysLogVO {
	return SysLogVO{
		ID:         l.ID,
		UserID:     l.UserID,
		Username:   l.Username,
		Action:     l.Action,
		Target:     l.Target,
		Detail:     l.Detail,
		IP:         l.IP,
		CreateTime: l.CreateTime,
	}
}

// ---- 时间/日期辅助 ----

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
