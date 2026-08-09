package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// Notification is a per-user notification (/api/notifications).
type Notification struct {
	BaseModel

	UserID idgen.ID `gorm:"column:user_id;index;not null" json:"userId"`
	// Type: system / like / comment / follow / order ...
	Type    string `gorm:"column:type;type:varchar(32);not null" json:"type"`
	Title   string `gorm:"column:title;type:varchar(128)" json:"title"`
	Content string `gorm:"column:content;type:text" json:"content"`
	LinkURL string `gorm:"column:link_url;type:varchar(512)" json:"linkUrl"`
	// RefID points at the related entity (post / comment / order ...), optional.
	RefID *idgen.ID `gorm:"column:ref_id;index" json:"refId"`
	// IsRead: 0 未读 / 1 已读.
	IsRead   int        `gorm:"column:is_read;type:tinyint;not null;default:0" json:"isRead"`
	ReadTime *time.Time `gorm:"column:read_time" json:"readTime"`
	// ExpireTime：过期后不再作为「活跃」通知展示（紧急横幅用）；nil = 永不过期。
	ExpireTime *time.Time `gorm:"column:expire_time;index" json:"expireTime"`
}

// TableName overrides the default pluralization.
func (Notification) TableName() string { return "notification" }

// SysRole is an admin permission role (sys_role); User.RoleID references it.
type SysRole struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Code string `gorm:"column:code;type:varchar(64);uniqueIndex" json:"code"`
	// Permissions is a JSON array of permission keys.
	Permissions string `gorm:"column:permissions;type:json" json:"permissions"`
	Description string `gorm:"column:description;type:varchar(255)" json:"description"`
	// Status: 0 禁用 / 1 启用.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (SysRole) TableName() string { return "sys_role" }
