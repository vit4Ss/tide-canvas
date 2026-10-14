package model

import (
	"tidecanvas/internal/pkg/idgen"
	"time"
)

// PromptSafetyCheck retains a decision receipt, never raw prompts or credentials.
type PromptSafetyCheck struct {
	ID                idgen.ID `gorm:"primaryKey;autoIncrement:false"`
	UserID            idgen.ID `gorm:"index;not null"`
	ModelID           idgen.ID
	PromptHash        string    `gorm:"size:64;not null"`
	Action            string    `gorm:"size:16;not null"`
	Reason            string    `gorm:"size:32;not null"`
	ProviderRequestID string    `gorm:"size:128"`
	CreateTime        time.Time `gorm:"index;not null"`
}
