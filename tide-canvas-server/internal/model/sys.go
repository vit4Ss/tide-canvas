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
}

// TableName overrides the default pluralization.
func (Notification) TableName() string { return "notification" }

// Banner is a home / promo banner (sys_banner, /api/banners + admin).
type Banner struct {
	BaseModel

	Title    string `gorm:"column:title;type:varchar(128)" json:"title"`
	ImageURL string `gorm:"column:image_url;type:varchar(512);not null" json:"imageUrl"`
	LinkURL  string `gorm:"column:link_url;type:varchar(512)" json:"linkUrl"`
	// Position: home_top / explore / pricing ... (placement key).
	Position  string `gorm:"column:position;type:varchar(32)" json:"position"`
	SortOrder int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	// Status: 0 隐藏 / 1 显示.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (Banner) TableName() string { return "sys_banner" }

// Team is a collaboration team; users reference it via User.TeamID.
type Team struct {
	BaseModel

	Name    string   `gorm:"column:name;type:varchar(128);not null" json:"name"`
	OwnerID idgen.ID `gorm:"column:owner_id;index;not null" json:"ownerId"`
	Avatar  string   `gorm:"column:avatar;type:varchar(512)" json:"avatar"`
	// PriceFactor is the AI consumption markup applied to team members.
	PriceFactor float64 `gorm:"column:price_factor;type:decimal(6,3);not null;default:1" json:"priceFactor"`
	MemberLimit int     `gorm:"column:member_limit;type:int;not null;default:0" json:"memberLimit"`
	// Status: 0 禁用 / 1 正常.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (Team) TableName() string { return "team" }

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
