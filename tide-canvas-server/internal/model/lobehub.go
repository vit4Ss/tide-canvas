package model

import (
	"tidecanvas/internal/pkg/idgen"
	"time"
)

// LobeHubGrant contains short-lived, single-use authorization/launch handles.
// Only the hash of a handle is stored; provider credentials never enter Payload.
type LobeHubGrant struct {
	Hash       string     `gorm:"primaryKey;size:64" json:"-"`
	Kind       string     `gorm:"size:24;not null;index" json:"-"`
	UserID     idgen.ID   `gorm:"index" json:"-"`
	Payload    string     `gorm:"type:text" json:"-"`
	ExpiresAt  time.Time  `gorm:"index;not null" json:"-"`
	ConsumedAt *time.Time `json:"-"`
}

func (LobeHubGrant) TableName() string { return "lobehub_grant" }

type LobeHubLink struct {
	UserID      idgen.ID   `gorm:"primaryKey;autoIncrement:false" json:"userId"`
	LobeUserID  string     `gorm:"size:128;uniqueIndex;not null" json:"-"`
	KeyRevision uint64     `json:"keyRevision"`
	ConnectedAt *time.Time `json:"connectedAt,omitempty"`
	SyncToken   string     `gorm:"size:64" json:"-"`
	SyncUntil   *time.Time `json:"-"`
}

func (LobeHubLink) TableName() string { return "lobehub_link" }

// ModelGatewayRequest is the durable billing and replay fence for API calls.
type ModelGatewayRequest struct {
	BaseModel
	UserID       idgen.ID  `gorm:"uniqueIndex:idx_gateway_request,priority:1;index" json:"userId"`
	RequestKey   string    `gorm:"size:64;uniqueIndex:idx_gateway_request,priority:2" json:"-"`
	BodyHash     string    `gorm:"size:64" json:"-"`
	ModelKey     string    `gorm:"size:128" json:"model"`
	Cost         int       `json:"cost"`
	Status       string    `gorm:"size:20;index" json:"status"`
	ResponseBody string    `gorm:"type:longtext" json:"-"`
	ErrorCode    string    `gorm:"size:64" json:"errorCode"`
	ExpiresAt    time.Time `gorm:"index" json:"-"`
}

func (ModelGatewayRequest) TableName() string { return "model_gateway_request" }
