package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// UserAPIKey is the single default integration credential owned by an account.
// It is separate from the legacy administrator-created api_key records, which
// have no owner. Secrets must never be exposed through user/list serialization.
type UserAPIKey struct {
	UserID     idgen.ID   `gorm:"primaryKey;autoIncrement:false" json:"userId"`
	KeyHash    string     `gorm:"size:64;not null;uniqueIndex" json:"-"`
	Ciphertext string     `gorm:"type:text;not null" json:"-"`
	Hint       string     `gorm:"size:64;not null" json:"hint"`
	Revision   uint64     `gorm:"not null;default:1" json:"revision"`
	DisabledAt *time.Time `json:"disabledAt,omitempty"`
	CreateTime time.Time  `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime time.Time  `gorm:"autoUpdateTime" json:"updateTime"`
}

func (UserAPIKey) TableName() string { return "user_api_key" }
