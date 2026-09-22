package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// ModelGatewayRequest is the durable billing and replay fence for one call
// through the OpenAI-compatible chat gateway (/api/integrations/v1). A row is
// created with the reservation before the provider is called and settled from
// the usage the provider reports; the same row answers an idempotent replay.
type ModelGatewayRequest struct {
	BaseModel
	// Explicit provenance: legacy rows are intentionally not guessed from a
	// model name, since market_model and chat_model may share the same key.
	Source              string   `gorm:"size:32;not null;default:'';index:idx_gateway_source_user,priority:1;index" json:"-"`
	RequestPath         string   `gorm:"size:128" json:"-"`
	ClientIP            string   `gorm:"size:64" json:"-"`
	Stream              bool     `json:"-"`
	KeyHint             string   `gorm:"size:64" json:"-"`
	ModelName           string   `gorm:"size:128" json:"-"`
	BillingProviderID   idgen.ID `json:"-"`
	BillingProviderName string   `gorm:"size:64" json:"-"`
	PriceMultiplier     string   `gorm:"size:16" json:"-"`
	ProviderID          idgen.ID `json:"-"`
	ProviderName        string   `gorm:"size:64" json:"-"`
	EndpointID          idgen.ID `json:"-"`
	UpstreamStatus      int      `json:"-"`
	// Empty is a legacy request with unknown dispatch state. New requests move
	// reserved -> started -> finished, so crash recovery can distinguish calls
	// never sent upstream from calls whose consumption is no longer known.
	UpstreamState     string     `gorm:"size:16;not null;default:''" json:"-"`
	DurationMs        *int64     `json:"-"`
	FirstTokenMs      *int64     `json:"-"`
	UsageKnown        bool       `json:"-"`
	UserID            idgen.ID   `gorm:"uniqueIndex:idx_gateway_request,priority:1;index;index:idx_gateway_source_user,priority:2" json:"userId"`
	RequestKey        string     `gorm:"size:64;uniqueIndex:idx_gateway_request,priority:2" json:"-"`
	BodyHash          string     `gorm:"size:64" json:"-"`
	ModelKey          string     `gorm:"size:128" json:"model"`
	Cost              int        `json:"cost"`
	BillingMode       string     `gorm:"size:16;not null;default:''" json:"billingMode"`
	KeyRevision       uint64     `gorm:"not null;default:0" json:"keyRevision"`
	ReservedMicros    int64      `gorm:"not null;default:0" json:"reservedMicros"`
	CostMicros        int64      `gorm:"not null;default:0" json:"costMicros"`
	PricingSnapshot   string     `gorm:"type:text" json:"-"`
	MaxOutputTokens   int64      `gorm:"not null;default:0" json:"maxOutputTokens"`
	InputTokens       int64      `gorm:"not null;default:0" json:"inputTokens"`
	OutputTokens      int64      `gorm:"not null;default:0" json:"outputTokens"`
	CachedInputTokens int64      `gorm:"not null;default:0" json:"cachedInputTokens"`
	ReasoningTokens   int64      `gorm:"not null;default:0" json:"reasoningTokens"`
	BillingResolution string     `gorm:"size:500" json:"-"`
	BillingResolvedBy idgen.ID   `gorm:"not null;default:0" json:"-"`
	BillingResolvedAt *time.Time `json:"-"`
	Status            string     `gorm:"size:20;index" json:"status"`
	ResponseBody      string     `gorm:"type:longtext" json:"-"`
	ErrorCode         string     `gorm:"size:64" json:"errorCode"`
	ExpiresAt         time.Time  `gorm:"index" json:"-"`
}

func (ModelGatewayRequest) TableName() string { return "model_gateway_request" }
