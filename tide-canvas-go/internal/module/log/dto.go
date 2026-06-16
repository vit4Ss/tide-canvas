// Package log 日志模块：访问日志(access_log) / 登录日志(login_log) / 操作日志(sys_log)
// 的管理端查询与统计，以及供其他模块调用的操作日志写入辅助 RecordOperation。
//
// 忠实迁移旧后端 controller/admin 下的 AdminAccessLogController、AdminLoginLogController、
// AdminLogController（操作日志），以及 OperateLogAspect（@OperateLog 切面 → RecordOperation）、
// AccessLogMapper 的 PV/UV 聚合。管理端路由统一前缀 /api/admin/logs/*，全部 JWTAuth + AdminOnly。
//
// ID 规范：日志表（access_log/login_log/sys_log）为 BaseModel，无 public_id，对外沿用数值主键 id
// （与旧 VO、points 流水 VO 一致），删除/定位按主键 int64 操作。
package log

import "time"

// ---- 分页查询基类 ----

// PageQuery 分页查询基类（对齐旧 PageQuery 默认值与边界：pageNum>=1，1<=pageSize<=100，默认20）。
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize 校正分页参数。
func (q *PageQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// Offset 返回 SQL OFFSET。
func (q *PageQuery) Offset() int { return (q.PageNum - 1) * q.PageSize }

// ---- 查询条件 ----

// AccessLogQuery 访问日志查询（对齐 AccessLogQuery）。时间格式 yyyy-MM-dd HH:mm:ss。
type AccessLogQuery struct {
	PageQuery
	UserID    *int64 `form:"userId"`
	Path      string `form:"path"`    // 路径关键字(模糊)
	Keyword   string `form:"keyword"` // 用户名/IP 关键字(模糊)
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// LoginLogQuery 登录日志查询（对齐 LoginLogQuery）。
type LoginLogQuery struct {
	PageQuery
	Keyword   string `form:"keyword"` // 登录账号/IP 关键字(模糊)
	Status    *int   `form:"status"`  // 结果(1:成功,0:失败)，空为全部
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// SysLogQuery 操作日志查询（对齐 LogQuery）。
type SysLogQuery struct {
	PageQuery
	UserID    *int64 `form:"userId"`
	Action    string `form:"action"`  // 操作动作(精确)
	Keyword   string `form:"keyword"` // 详情关键字(模糊)
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// ---- 视图对象 ----

// AccessLogVO 访问日志视图（对齐 AccessLogVO）。
type AccessLogVO struct {
	ID         int64     `json:"id"`
	UserID     *int64    `json:"userId"`
	Username   string    `json:"username"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Query      string    `json:"query"`
	Status     *int      `json:"status"`
	DurationMs *int64    `json:"durationMs"`
	IP         string    `json:"ip"`
	UserAgent  string    `json:"userAgent"`
	CreateTime time.Time `json:"createTime"`
}

// LoginLogVO 登录日志视图（对齐 LoginLogVO）。
type LoginLogVO struct {
	ID         int64     `json:"id"`
	UserID     *int64    `json:"userId"`
	Username   string    `json:"username"`
	Status     int       `json:"status"` // 1:成功 0:失败
	FailReason string    `json:"failReason"`
	IP         string    `json:"ip"`
	UserAgent  string    `json:"userAgent"`
	CreateTime time.Time `json:"createTime"`
}

// SysLogVO 操作日志视图（对齐 LogVO）。
type SysLogVO struct {
	ID         int64     `json:"id"`
	UserID     *int64    `json:"userId"`
	Username   string    `json:"username"`
	Action     string    `json:"action"`
	Target     string    `json:"target"`
	Detail     string    `json:"detail"`
	IP         string    `json:"ip"`
	CreateTime time.Time `json:"createTime"`
}

// LogStatsVO 访问统计：今日 PV/UV/登录 + 近 N 天 PV/UV 趋势（聚合 AccessLogMapper 的统计能力）。
type LogStatsVO struct {
	TodayPv    int64          `json:"todayPv"`    // 今日访问量(IP+半小时会话去重)
	TodayUv    int64          `json:"todayUv"`    // 今日独立访客(IP 去重)
	TodayLogin int64          `json:"todayLogin"` // 今日成功登录次数
	VisitTrend []DailyVisitVO `json:"visitTrend"` // 近 N 天 PV/UV 趋势
}

// DailyVisitVO 单日访问趋势（对齐 DashboardChartsVO.DailyVisitVO）。
type DailyVisitVO struct {
	Date string `json:"date"`
	PV   int64  `json:"pv"`
	UV   int64  `json:"uv"`
}

// dateCountRow 日期-计数聚合行（GORM Scan 目标，对齐旧 Map<String,Object> 的 date/count）。
type dateCountRow struct {
	Date  string `gorm:"column:date"`
	Count int64  `gorm:"column:count"`
}
