package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidateModelPromptCharLimit(t *testing.T) {
	video := func(config string) *model.AiModel {
		return &model.AiModel{Type: "video", Config: config}
	}
	dto := func(prompt string) *generateDTO {
		input, err := json.Marshal(map[string]any{"prompt": prompt})
		if err != nil {
			t.Fatal(err)
		}
		return &generateDTO{Input: input}
	}

	if err := validateModelPromptCharLimit(dto(strings.Repeat("字", 20)), video(`{"maxPromptChars":0}`)); err != nil {
		t.Fatalf("zero must remain unlimited: %v", err)
	}
	if err := validateModelPromptCharLimit(dto("中文A🙂"), video(`{"maxPromptChars":4}`)); err != nil {
		t.Fatalf("Unicode boundary was rejected: %v", err)
	}
	err := validateModelPromptCharLimit(dto("中文A🙂B"), video(`{"maxPromptChars":4}`))
	if err == nil || !strings.Contains(err.Error(), "当前 5 字") || !strings.Contains(err.Error(), "4 字限制") {
		t.Fatalf("overflow error = %v", err)
	}
	if err := validateModelPromptCharLimit(dto(strings.Repeat("字", 20)), &model.AiModel{Type: "image", Config: `{"maxPromptChars":4}`}); err != nil {
		t.Fatalf("non-video models must ignore the video setting: %v", err)
	}
}
