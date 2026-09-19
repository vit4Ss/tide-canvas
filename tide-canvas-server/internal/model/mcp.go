package model

import "time"

// MCPSettings is a singleton, versioned policy for the separately deployed
// generation MCP service. It intentionally stores no user/upstream credentials.
type MCPSettings struct {
	ID        uint   `gorm:"primaryKey;autoIncrement:false"`
	Revision  uint64 `gorm:"not null"`
	Payload   string `gorm:"type:text;not null"`
	UpdatedAt time.Time
}

func (MCPSettings) TableName() string { return "mcp_settings" }
