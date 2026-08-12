package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// ActivationCode is an administrator-issued points voucher. CodeHash is the
// only persisted representation of the secret; CodeHint is safe to show in
// admin lists and audit views. The plaintext code is returned once at creation.
type ActivationCode struct {
	BaseModel

	CodeHash  string `gorm:"column:code_hash;type:char(64);uniqueIndex;not null" json:"-"`
	CodeHint  string `gorm:"column:code_hint;type:varchar(32);index;not null" json:"codeHint"`
	BatchName string `gorm:"column:batch_name;type:varchar(64);index;not null" json:"batchName"`
	Points    int    `gorm:"column:points;type:int;not null" json:"points"`
	// UsageLimit is the total number of distinct users that may redeem this code.
	UsageLimit int `gorm:"column:usage_limit;type:int;not null" json:"usageLimit"`
	UsedCount  int `gorm:"column:used_count;type:int;not null;default:0" json:"usedCount"`
	// Status: 0 disabled / 1 enabled. Expiry and exhaustion are derived states.
	Status     int        `gorm:"column:status;type:tinyint;index;not null;default:1" json:"status"`
	ExpiresAt  time.Time  `gorm:"column:expires_at;index;not null" json:"expiresAt"`
	CreatedBy  idgen.ID   `gorm:"column:created_by;index;not null" json:"createdBy"`
	LastUsedAt *time.Time `gorm:"column:last_used_at" json:"lastUsedAt"`
}

func (ActivationCode) TableName() string { return "activation_code" }

// ActivationCodeClaim is the immutable redemption receipt. The composite
// unique index makes one code redeemable by a given user at most once, while a
// code may still be configured for multiple distinct users.
type ActivationCodeClaim struct {
	BaseModel

	ActivationCodeID idgen.ID `gorm:"column:activation_code_id;index;index:idx_activation_code_user,unique;not null" json:"activationCodeId"`
	UserID           idgen.ID `gorm:"column:user_id;index;index:idx_activation_code_user,unique;not null" json:"userId"`
	BatchName        string   `gorm:"column:batch_name;type:varchar(64);not null" json:"batchName"`
	CodeHint         string   `gorm:"column:code_hint;type:varchar(32);not null" json:"codeHint"`
	Points           int      `gorm:"column:points;type:int;not null" json:"points"`
	Balance          int      `gorm:"column:balance;type:int;not null" json:"balance"`
	ClientIP         string   `gorm:"column:client_ip;type:varchar(64)" json:"clientIp"`
	UserAgent        string   `gorm:"column:user_agent;type:varchar(512)" json:"userAgent"`
}

func (ActivationCodeClaim) TableName() string { return "activation_code_claim" }
