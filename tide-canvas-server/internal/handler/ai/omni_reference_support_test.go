package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidateOmniReferenceInput(t *testing.T) {
	tests := []struct {
		name    string
		handler string
		config  string
		input   string
		wantErr string
	}{
		{
			name:    "legacy config supports every kind",
			handler: "reference_to_video",
			config:  `{}`,
			input:   `{"references":["image"],"videoReferences":["video"],"audioReferences":["audio"]}`,
		},
		{
			name:    "disabled image",
			handler: "reference_to_video",
			config:  `{"omniRefImageEnabled":false}`,
			input:   `{"imageList":["image"]}`,
			wantErr: "不支持参考图片",
		},
		{
			name:    "disabled image legacy fields",
			handler: "reference_to_video",
			config:  `{"omniRefImageEnabled":false}`,
			input:   `{"sourceImage":"image","references":["other-image"]}`,
			wantErr: "不支持参考图片",
		},
		{
			name:    "disabled video alias",
			handler: "reference_to_video",
			config:  `{"omniRefVideoEnabled":false}`,
			input:   `{"video_urls":["video"]}`,
			wantErr: "不支持参考视频",
		},
		{
			name:    "disabled audio",
			handler: "reference_to_video",
			config:  `{"omniRefAudioEnabled":false}`,
			input:   `{"audioReferences":["audio"]}`,
			wantErr: "不支持参考音频",
		},
		{
			name:    "other handlers unaffected",
			handler: "image_to_video",
			config:  `{"omniRefImageEnabled":false}`,
			input:   `{"sourceImage":"image"}`,
		},
		{
			name:    "empty disabled kinds are allowed",
			handler: "reference_to_video",
			config:  `{"omniRefVideoEnabled":false,"omniRefAudioEnabled":false}`,
			input:   `{"references":["image"],"videoReferences":[],"audioReferences":[]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dto := generateDTO{Handler: tt.handler, Input: json.RawMessage(tt.input)}
			m := &model.AiModel{Type: "video", Config: tt.config}
			err := validateOmniReferenceInput(&dto, m)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
		})
	}
}
