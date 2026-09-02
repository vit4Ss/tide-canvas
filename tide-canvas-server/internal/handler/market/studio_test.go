package market

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNormalizedStudioConfigSortsDurationsNumerically(t *testing.T) {
	raw := `{"durations":["4s","15s","5s","6s","7s","8s","10s","9s","11s","12s","13s","14s"],"resolutions":["720p","1080p"]}`
	got := normalizedStudioConfig(raw)
	var cfg struct {
		Durations   []string `json:"durations"`
		Resolutions []string `json:"resolutions"`
	}
	if err := json.Unmarshal(got, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	want := []string{"4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"}
	if !reflect.DeepEqual(cfg.Durations, want) {
		t.Fatalf("durations = %v, want %v", cfg.Durations, want)
	}
	if !reflect.DeepEqual(cfg.Resolutions, []string{"720p", "1080p"}) {
		t.Fatalf("unrelated config changed: %v", cfg.Resolutions)
	}
}

func TestNormalizedStudioConfigKeepsMixedDurationRepresentations(t *testing.T) {
	raw := `{"durations":[15,"4s","10S",5]}`
	got := normalizedStudioConfig(raw)
	var cfg struct {
		Durations []json.RawMessage `json:"durations"`
	}
	if err := json.Unmarshal(got, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	values := make([]string, len(cfg.Durations))
	for i := range cfg.Durations {
		values[i] = string(cfg.Durations[i])
	}
	want := []string{`"4s"`, "5", `"10S"`, "15"}
	if !reflect.DeepEqual(values, want) {
		t.Fatalf("durations = %v, want %v", values, want)
	}
}

func TestNormalizedStudioConfigRejectsInvalidJSON(t *testing.T) {
	if got := normalizedStudioConfig(`{"durations":`); got != nil {
		t.Fatalf("invalid config = %s, want nil", got)
	}
}

func TestNormalizedStudioConfigAliasesLegacyPricing(t *testing.T) {
	got := normalizedStudioConfig(`{"pricing":{"default":{"4k":120}},"resolutions":["1080p","4k"]}`)
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(got, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	if string(cfg["priceMatrix"]) != string(cfg["pricing"]) {
		t.Fatalf("priceMatrix alias = %s, pricing = %s", cfg["priceMatrix"], cfg["pricing"])
	}
}

func TestNormalizedStudioConfigPreservesOmniReferenceCapabilities(t *testing.T) {
	got := normalizedStudioConfig(`{"durations":["10s","5s"],"omniRefImageEnabled":false,"omniRefVideoEnabled":true,"omniRefAudioEnabled":false}`)
	var cfg struct {
		ImageEnabled bool `json:"omniRefImageEnabled"`
		VideoEnabled bool `json:"omniRefVideoEnabled"`
		AudioEnabled bool `json:"omniRefAudioEnabled"`
	}
	if err := json.Unmarshal(got, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	if cfg.ImageEnabled || !cfg.VideoEnabled || cfg.AudioEnabled {
		t.Fatalf("omni reference capabilities changed: %#v", cfg)
	}
}

func TestNormalizedStudioConfigLeavesUnrelatedLegacyPayloadUntouched(t *testing.T) {
	raw := `{ "creditCost": 12.5, "custom": [1, 2] }`
	if got := string(normalizedStudioConfig(raw)); got != raw {
		t.Fatalf("unrelated config changed: got %s, want %s", got, raw)
	}
}

// errorHints 是管理员的错误提示映射,匹配片段可能含供应商后缀的模型名,
// 创作台公开目录必须剥离(与 ai 包 publicModelConfigJSON 同口径)。
func TestNormalizedStudioConfigStripsErrorHints(t *testing.T) {
	got := normalizedStudioConfig(`{"resolutions":["1080p"],"hideBatchCount":true,"availabilityStatus":"maintenance","errorHints":[{"contains":"vip-Dimensio","message":"文案"}]}`)
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(got, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	if _, exists := cfg["errorHints"]; exists {
		t.Fatalf("studio config leaked errorHints: %s", got)
	}
	if _, exists := cfg["resolutions"]; !exists {
		t.Fatalf("unrelated key lost: %s", got)
	}
	if string(cfg["hideBatchCount"]) != "true" {
		t.Fatalf("batch count visibility lost: %s", got)
	}
	if string(cfg["availabilityStatus"]) != `"maintenance"` {
		t.Fatalf("availability status lost: %s", got)
	}
}
