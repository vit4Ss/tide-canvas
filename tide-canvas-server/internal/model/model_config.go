package model

import (
	"encoding/json"
	"strings"
)

const ModelAvailabilityMaintenance = "maintenance"

// ModelConfigSupportsMask is explicitly opt-in; ordinary image editing is not
// proof that an upstream accepts a spatial mask.
func ModelConfigSupportsMask(raw string) bool {
	var cfg struct {
		SupportsMask bool `json:"supportsMask"`
	}
	return json.Unmarshal([]byte(raw), &cfg) == nil && cfg.SupportsMask
}

// ModelConfigUnderMaintenance reads the admin-owned runtime state shared by
// market_model and ai_model config payloads. Missing/invalid values stay normal
// for backward compatibility.
func ModelConfigUnderMaintenance(raw string) bool {
	var cfg struct {
		AvailabilityStatus string `json:"availabilityStatus"`
	}
	if json.Unmarshal([]byte(raw), &cfg) != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(cfg.AvailabilityStatus), ModelAvailabilityMaintenance)
}
