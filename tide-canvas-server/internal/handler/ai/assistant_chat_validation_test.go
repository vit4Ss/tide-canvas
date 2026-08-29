package ai

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/relaychat"
)

func assistantChatValidationDTO(count int) generateDTO {
	attachments := make([]map[string]any, count)
	for i := range attachments {
		attachments[i] = map[string]any{
			"name": "reference.png",
			"url":  "https://cdn.example.com/reference.png",
			"type": "image",
		}
	}
	raw, _ := json.Marshal(map[string]any{
		"prompt":      "分析这些图片",
		"attachments": attachments,
	})
	return generateDTO{Handler: assistantChatHandler, Input: raw}
}

func TestValidateAssistantChatInputBeforeCharge(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		count   int
		wantErr string
	}{
		{
			name:    "explicitly disabled model",
			config:  `{"fileUpload":false}`,
			count:   1,
			wantErr: "不支持图片或文件输入",
		},
		{
			name:    "legacy schema disabled model",
			config:  `{"paramsSchema":{"file_upload":false}}`,
			count:   1,
			wantErr: "不支持图片或文件输入",
		},
		{
			name:    "model attachment cap",
			config:  `{"fileUpload":true,"maxFileCount":10}`,
			count:   11,
			wantErr: "最多分析 10 个附件",
		},
		{
			name:    "wire hard cap",
			config:  `{"fileUpload":true}`,
			count:   maxAssistantChatAttachments + 1,
			wantErr: "一次最多分析 12 个附件",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dto := assistantChatValidationDTO(tt.count)
			err := validateAssistantChatInput(&dto, &model.AiModel{Config: tt.config})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want text containing %q", err, tt.wantErr)
			}
			var placement skillPlacementError
			if !errors.As(err, &placement) {
				t.Fatalf("error type = %T, want skillPlacementError", err)
			}
		})
	}
}

func TestValidateAssistantChatInputAllowsLegacyUnconfiguredModel(t *testing.T) {
	dto := assistantChatValidationDTO(11)
	if err := validateAssistantChatInput(&dto, &model.AiModel{}); err != nil {
		t.Fatalf("unconfigured legacy model rejected attachments: %v", err)
	}
}

func TestUserFacingGenerationErrorExplainsPayloadTooLarge(t *testing.T) {
	got := userFacingGenError(&relaychat.HTTPError{StatusCode: 413})
	if !strings.Contains(got, "总体积") || !strings.Contains(got, "压缩") {
		t.Fatalf("413 message = %q, want actionable payload-size guidance", got)
	}
}
