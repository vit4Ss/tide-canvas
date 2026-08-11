package ai

import (
	"testing"

	"tidecanvas/internal/model"
)

func TestToolVOCoverURLPreservesConfiguredAndLegacyValues(t *testing.T) {
	configured := toToolVO(&model.AiTool{CoverURL: "https://cdn.example/tool.webp"})
	if configured.CoverURL != "https://cdn.example/tool.webp" {
		t.Fatalf("configured cover URL changed: %q", configured.CoverURL)
	}

	legacy := toToolVO(&model.AiTool{})
	if legacy.CoverURL != "" {
		t.Fatalf("legacy empty cover URL must remain empty, got %q", legacy.CoverURL)
	}
}
