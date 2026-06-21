package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// AiProvider is an upstream AI provider / relay station. It backs the admin
// provider endpoints and is the route target resolved from a model's modelId.
//
// This entity follows the inline-field style of the other AI entities in
// model.go (explicit ID/CreateTime/UpdateTime, no soft-delete) so the AI domain
// treats all AI entities uniformly. Secrets (ApiKey/BackupKeys) are never
// serialized.
type AiProvider struct {
	ID           idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	Name         string    `gorm:"size:64" json:"name"`
	ProviderType string    `gorm:"size:32;index" json:"providerType"` // openai|gemini|doubao|relay...
	ApiKey       string    `gorm:"size:512" json:"-"`
	BackupKeys   string    `gorm:"type:text" json:"-"` // JSON array of backup keys
	BaseUrl      string    `gorm:"size:255" json:"baseUrl"`
	Status       int       `gorm:"default:1" json:"status"` // 0 disabled, 1 enabled
	Priority     int       `gorm:"default:0" json:"priority"`
	RateLimit    int       `gorm:"default:0" json:"rateLimit"` // requests per minute, 0 = unlimited
	Config       string    `gorm:"type:text" json:"config"`    // provider-specific JSON config
	CreateTime   time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime   time.Time `gorm:"autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralized table name.
func (AiProvider) TableName() string { return "ai_providers" }
