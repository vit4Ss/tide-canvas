package model

import (
	"github.com/shopspring/decimal"

	"tidecanvas/internal/pkg/idgen"
)

// log.go holds the structured audit-log entities written by internal/pkg/eventlog:
// API access logs, login logs, business logs and upstream model-call logs. All are
// append-only and read by the admin 日志 screens.

// AccessLog records one API request (written asynchronously by the access-log
// middleware). High-frequency reads (health, static, task polling) are excluded
// at the middleware so this table stays signal-rich.
type AccessLog struct {
	BaseModel

	UserID    idgen.ID `gorm:"column:user_id;index" json:"userId"`
	Method    string   `gorm:"column:method;type:varchar(8)" json:"method"`
	Path      string   `gorm:"column:path;type:varchar(512);index" json:"path"`
	Query     string   `gorm:"column:query;type:varchar(1024)" json:"query"`
	Status    int      `gorm:"column:status;index" json:"status"`
	LatencyMs int64    `gorm:"column:latency_ms" json:"latencyMs"`
	IP        string   `gorm:"column:ip;type:varchar(64)" json:"ip"`
	UserAgent string   `gorm:"column:user_agent;type:varchar(512)" json:"userAgent"`
	RequestID string   `gorm:"column:request_id;type:varchar(64);index" json:"requestId"`
}

// TableName overrides the default pluralization.
func (AccessLog) TableName() string { return "access_log" }

// LoginLog records an authentication event (login / register / logout /
// passwordless login), including failures.
type LoginLog struct {
	BaseModel

	UserID     idgen.ID `gorm:"column:user_id;index" json:"userId"`
	Account    string   `gorm:"column:account;type:varchar(128);index" json:"account"`
	Action     string   `gorm:"column:action;type:varchar(32);index" json:"action"`   // login|register|logout|login_code
	Channel    string   `gorm:"column:channel;type:varchar(32)" json:"channel"`        // password|code
	Success    int      `gorm:"column:success;index" json:"success"`                   // 0 fail / 1 ok
	FailReason string   `gorm:"column:fail_reason;type:varchar(255)" json:"failReason"`
	IP         string   `gorm:"column:ip;type:varchar(64)" json:"ip"`
	UserAgent  string   `gorm:"column:user_agent;type:varchar(512)" json:"userAgent"`
}

// TableName overrides the default pluralization.
func (LoginLog) TableName() string { return "login_log" }

// BizLog records a key business event (points granted, order created/paid,
// membership opened, payment) so revenue- and credit-affecting actions have a
// dedicated audit trail beyond the domain ledgers.
type BizLog struct {
	BaseModel

	UserID     idgen.ID        `gorm:"column:user_id;index" json:"userId"`
	Action     string          `gorm:"column:action;type:varchar(48);index" json:"action"`
	Summary    string          `gorm:"column:summary;type:varchar(255)" json:"summary"`
	Amount     decimal.Decimal `gorm:"column:amount;type:decimal(10,2);not null;default:0" json:"amount"` // money (yuan)
	Points     int64           `gorm:"column:points;not null;default:0" json:"points"`                    // credit delta
	RefID      idgen.ID        `gorm:"column:ref_id;index" json:"refId"`                                  // order / record id
	RefType    string          `gorm:"column:ref_type;type:varchar(32)" json:"refType"`                   // order|point_record|...
	OperatorID idgen.ID        `gorm:"column:operator_id;index" json:"operatorId"`                        // admin actor, 0 if self/system
	Detail     string          `gorm:"column:detail;type:text" json:"detail"`                             // JSON snapshot
}

// TableName overrides the default pluralization.
func (BizLog) TableName() string { return "biz_log" }

// ModelCallLog records one call to the upstream relay model service (text chat,
// prompt optimization, image and video generation), capturing the request and
// response bodies for debugging and cost/usage auditing.
type ModelCallLog struct {
	BaseModel

	UserID         idgen.ID `gorm:"column:user_id;index" json:"userId"`
	Scene          string   `gorm:"column:scene;type:varchar(32);index" json:"scene"` // chat|optimize|image|video
	Model          string   `gorm:"column:model;type:varchar(128);index" json:"model"`
	Endpoint       string   `gorm:"column:endpoint;type:varchar(255)" json:"endpoint"`
	RequestBody    string   `gorm:"column:request_body;type:longtext" json:"requestBody"`
	ResponseBody   string   `gorm:"column:response_body;type:longtext" json:"responseBody"`
	HttpStatus     int      `gorm:"column:http_status;index" json:"httpStatus"`
	Success        int      `gorm:"column:success;index" json:"success"` // 0 fail / 1 ok
	ErrorMsg       string   `gorm:"column:error_msg;type:varchar(1024)" json:"errorMsg"`
	DurationMs     int64    `gorm:"column:duration_ms" json:"durationMs"`
	UpstreamTaskID string   `gorm:"column:upstream_task_id;type:varchar(128)" json:"upstreamTaskId"`
	Cost           string   `gorm:"column:cost;type:varchar(64)" json:"cost"`
}

// TableName overrides the default pluralization.
func (ModelCallLog) TableName() string { return "model_call_log" }
