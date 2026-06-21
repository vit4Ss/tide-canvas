package model

import (
	"time"
)

// Admin-only system / platform entities: resource inventory, logs, config,
// email templates and API keys. These back the system & developer admin screens.

// AdminResource is a tracked platform resource (资源管理): buckets, CDNs, fonts
// and caches with usage and reference counts.
type AdminResource struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Type: bucket / cdn / font / cache.
	Type string `gorm:"column:type;type:varchar(16);not null" json:"type"`
	// Size is the resource size in bytes.
	Size int64 `gorm:"column:size;type:bigint;not null;default:0" json:"size"`
	// Refs is the number of entities referencing this resource.
	Refs int `gorm:"column:refs;type:int;not null;default:0" json:"refs"`
	// Status: active / idle / error / archived.
	Status     string    `gorm:"column:status;type:varchar(16);not null;default:'active'" json:"status"`
	UpdateTime time.Time `gorm:"column:resource_update_time" json:"updateTime"`
}

// TableName overrides the default pluralization.
func (AdminResource) TableName() string { return "admin_resource" }

// SysLog is a system / operation log entry (系统日志).
type SysLog struct {
	BaseModel

	// Level: debug / info / warn / error.
	Level   string `gorm:"column:level;type:varchar(16);not null;default:'info';index" json:"level"`
	Module  string `gorm:"column:module;type:varchar(64);index" json:"module"`
	Message string `gorm:"column:message;type:text" json:"message"`
	IP      string `gorm:"column:ip;type:varchar(64)" json:"ip"`
	// Operator is the username / id of who triggered the logged action.
	Operator   string    `gorm:"column:operator;type:varchar(64)" json:"operator"`
	CreateTime time.Time `gorm:"column:create_time;autoCreateTime" json:"createTime"`
}

// TableName overrides the default pluralization.
func (SysLog) TableName() string { return "sys_log" }

// SysConfig is a key-value platform configuration entry (系统配置).
type SysConfig struct {
	BaseModel

	ConfigKey   string `gorm:"column:config_key;type:varchar(128);uniqueIndex;not null" json:"configKey"`
	ConfigValue string `gorm:"column:config_value;type:text" json:"configValue"`
	// Group buckets related config keys (e.g. site / mail / pay / ai).
	Group       string `gorm:"column:config_group;type:varchar(64);index" json:"group"`
	Description string `gorm:"column:description;type:varchar(255)" json:"description"`
}

// TableName overrides the default pluralization.
func (SysConfig) TableName() string { return "sys_config" }

// EmailTemplate is a reusable transactional email template (邮件模板).
type EmailTemplate struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Type: html / text.
	Type string `gorm:"column:type;type:varchar(16);not null;default:'html'" json:"type"`
	// Scene: register / reset_password / order_paid / notify ...
	Scene string `gorm:"column:scene;type:varchar(64);index" json:"scene"`
	// Variables is a JSON array of placeholder names usable in the body.
	Variables string `gorm:"column:variables;type:json" json:"variables"`
	Subject   string `gorm:"column:subject;type:varchar(255)" json:"subject"`
	Body      string `gorm:"column:body;type:text" json:"body"`
	Enabled   bool   `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (EmailTemplate) TableName() string { return "email_template" }

// ApiKey is a developer / integration API credential (API 密钥).
type ApiKey struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Scope is a JSON array of permission scopes granted to the key.
	Scope    string `gorm:"column:scope;type:json" json:"scope"`
	KeyValue string `gorm:"column:key_value;type:varchar(255);uniqueIndex;not null" json:"keyValue"`
	// DailyLimit caps requests per day (0 = unlimited).
	DailyLimit int `gorm:"column:daily_limit;type:int;not null;default:0" json:"dailyLimit"`
	// Expiry is when the key stops working (zero = no expiry).
	Expiry  time.Time `gorm:"column:expiry" json:"expiry"`
	Enabled bool      `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (ApiKey) TableName() string { return "api_key" }
