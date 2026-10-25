package model

import (
	"tidecanvas/internal/pkg/idgen"
	"time"
)

// One active batch serializes cover work across administrators and instances.
// The nullable unique key is released only after the current task is settled.
type TemplateCoverBatch struct {
	BaseModel
	UserID        idgen.ID            `gorm:"index;uniqueIndex:idx_cover_request,priority:1" json:"userId"`
	RequestID     string              `gorm:"size:96;uniqueIndex:idx_cover_request,priority:2" json:"-"`
	QuoteToken    string              `gorm:"size:64" json:"-"`
	ActiveKey     *string             `gorm:"size:32;uniqueIndex" json:"-"`
	ModelID       string              `gorm:"size:128" json:"modelId"`
	ModelName     string              `gorm:"size:255" json:"modelName"`
	ModelHash     string              `gorm:"size:64" json:"-"`
	UnitCost      int                 `json:"unitCost"`
	Items         []TemplateCoverItem `gorm:"serializer:json;type:longtext" json:"items"`
	Status        string              `gorm:"size:24;index" json:"status"`
	StopRequested bool                `json:"stopRequested"`
	Error         string              `gorm:"size:512" json:"error"`
	Worker        string              `gorm:"size:96" json:"-"`
	LeaseUntil    *time.Time          `gorm:"index" json:"-"`
}

type TemplateCoverItem struct {
	TemplateID  idgen.ID `json:"templateId"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	// Snapshot is persisted inside ItemsJSON (not returned to the UI).
	Input     map[string]any `json:"input,omitempty"`
	TaskID    idgen.ID       `json:"taskId"`
	Status    string         `json:"status"` // pending, running, succeeded, failed, skipped
	Message   string         `json:"message"`
	ResultURL string         `json:"resultUrl"`
	PointCost int64          `json:"pointCost"`
	Attempts  int            `json:"attempts"`
}
