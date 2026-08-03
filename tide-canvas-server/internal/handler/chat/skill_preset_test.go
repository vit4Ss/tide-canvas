package chat

import (
	"strings"
	"testing"

	"tidecanvas/internal/handler/ai"
)

func TestPresetPromptRejectsExpansionBomb(t *testing.T) {
	preset := &ai.PublishedPreset{Prompt: strings.Repeat("{{prompt}}", 1000)}
	if _, err := presetPrompt(preset, strings.Repeat("x", 32<<10)); err == nil {
		t.Fatal("oversized rendered chat preset was accepted")
	}
}

func TestPresetPromptRendersBothPromptTokens(t *testing.T) {
	got, err := presetPrompt(&ai.PublishedPreset{Prompt: "A {{prompt}} B {{input.prompt}}"}, "hello")
	if err != nil || got != "A hello B hello" {
		t.Fatalf("presetPrompt = %q, %v", got, err)
	}
}
