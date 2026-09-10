package model

import (
	"encoding/json"
	"strings"
)

const ModelAvailabilityMaintenance = "maintenance"

// MaxModelPromptChars is the largest operator-configurable character limit.
// The generation pipeline also has a 1 MiB byte ceiling; this bound prevents a
// meaningless oversized policy value while leaving ample room for long prompts.
const MaxModelPromptChars = 1_000_000

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

// ModelConfigMaxPromptChars returns the configured Unicode-character limit.
// Missing, zero, negative and malformed values mean unlimited. Values above
// the admin ceiling are clamped defensively for manually edited legacy rows;
// the admin API rejects such values on write.
func ModelConfigMaxPromptChars(raw string) int {
	var cfg struct {
		MaxPromptChars int `json:"maxPromptChars"`
	}
	if json.Unmarshal([]byte(raw), &cfg) != nil || cfg.MaxPromptChars <= 0 {
		return 0
	}
	if cfg.MaxPromptChars > MaxModelPromptChars {
		return MaxModelPromptChars
	}
	return cfg.MaxPromptChars
}
