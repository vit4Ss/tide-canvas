package model

// SysLog 操作日志表 sys_log（后台操作审计，无逻辑删除）。
type SysLog struct {
	BaseModel
	UserID   *int64 `json:"userId" gorm:"column:user_id"`
	Username string `json:"username" gorm:"column:username"`
	Action   string `json:"action" gorm:"column:action"`
	Target   string `json:"target" gorm:"column:target"`
	Detail   string `json:"detail" gorm:"column:detail"`
	IP       string `json:"ip" gorm:"column:ip"`
}

// TableName 表名。
func (SysLog) TableName() string { return "sys_log" }

// AccessLog 访问日志表 access_log（请求级明细，PV/UV 统计，无逻辑删除）。
type AccessLog struct {
	BaseModel
	UserID     *int64 `json:"userId" gorm:"column:user_id"`
	Username   string `json:"username" gorm:"column:username"`
	Method     string `json:"method" gorm:"column:method"`
	Path       string `json:"path" gorm:"column:path"`
	Query      string `json:"query" gorm:"column:query"`
	Status     *int   `json:"status" gorm:"column:status"`
	DurationMs *int64 `json:"durationMs" gorm:"column:duration_ms"`
	IP         string `json:"ip" gorm:"column:ip"`
	UserAgent  string `json:"userAgent" gorm:"column:user_agent"`
}

// TableName 表名。
func (AccessLog) TableName() string { return "access_log" }

// LoginLog 登录日志表 login_log（成功+失败都记录，无逻辑删除）。
type LoginLog struct {
	BaseModel
	UserID     *int64 `json:"userId" gorm:"column:user_id"`
	Username   string `json:"username" gorm:"column:username"`
	Status     int    `json:"status" gorm:"column:status"`
	FailReason string `json:"failReason" gorm:"column:fail_reason"`
	IP         string `json:"ip" gorm:"column:ip"`
	UserAgent  string `json:"userAgent" gorm:"column:user_agent"`
}

// TableName 表名。
func (LoginLog) TableName() string { return "login_log" }
