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
