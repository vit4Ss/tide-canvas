package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidateReferenceCountInput(t *testing.T) {
	tests := []struct {
		name    string
		handler string
		config  string
		input   string
		wantErr string
	}{
		{
			name:    "omni images within configured cap",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":9}}`,
			input:   `{"references":["a","b","c"]}`,
		},
		{
			name:    "omni images over configured cap",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":9}}`,
			input:   `{"imageList":["1","2","3","4","5","6","7","8","9","10"]}`,
			wantErr: "最多支持 9 个参考图片",
		},
		{
			name:    "canvas node payload shape is gated too",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":4}}`,
			input:   `{"sourceImage":"a","references":["b","c","d","e"]}`,
			wantErr: "最多支持 4 个参考图片",
		},
		{
			name:    "string config value is honored",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":"2"}}`,
			input:   `{"references":["a","b","c"]}`,
			wantErr: "最多支持 2 个参考图片",
		},
		{
			name:    "omni video over cap",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.videoCount":1}}`,
			input:   `{"videoReferences":["a","b"]}`,
			wantErr: "最多支持 1 个参考视频",
		},
		{
			name:    "omni audio alias over cap",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.audioCount":1}}`,
			input:   `{"audio_urls":["a","b"]}`,
			wantErr: "最多支持 1 个参考音频",
		},
		{
			name:    "unset cap means unlimited",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":0}}`,
			input:   `{"imageList":["1","2","3","4","5","6","7","8","9","10","11","12"]}`,
		},
		{
			name:    "missing config means unlimited",
			handler: "reference_to_video",
			config:  `{}`,
			input:   `{"imageList":["1","2","3"]}`,
		},
		{
			name:    "duplicate urls collapse before counting",
			handler: "reference_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":2}}`,
			input:   `{"references":["a","a","b"]}`,
		},
		{
			// maxRefImages stays client-side: chat (maxFileCount) and 智能工具
			// (asset maxItems) legitimately exceed it and the relay accepts 1–16.
			name:    "image_to_image is not gated",
			handler: "image_to_image",
			config:  `{"maxRefImages":4}`,
			input:   `{"imageList":["1","2","3","4","5"]}`,
		},
		{
			// image_to_video forwards only the first URL, so extra entries are
			// inert and must not start failing.
			name:    "image_to_video is not gated",
			handler: "image_to_video",
			config:  `{"refLimits":{"i2v.imageCount":1}}`,
			input:   `{"imageList":["1","2","3"]}`,
		},
		{
			name:    "start_end_to_video is not gated",
			handler: "start_end_to_video",
			config:  `{"refLimits":{"keyframe.imageCount":2}}`,
			input:   `{"imageList":["1","2","3"]}`,
		},
		{
			name:    "text_to_video is not gated",
			handler: "text_to_video",
			config:  `{"refLimits":{"omniRef.imageCount":1}}`,
			input:   `{"prompt":"hi"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dto := generateDTO{Handler: tt.handler, Input: json.RawMessage(tt.input)}
			m := &model.AiModel{Type: "video", Config: tt.config}
			err := validateReferenceCountInput(&dto, m)
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

func TestValidateReferenceCountInputNilSafe(t *testing.T) {
	if err := validateReferenceCountInput(nil, &model.AiModel{}); err != nil {
		t.Fatalf("nil dto must be a no-op: %v", err)
	}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"references":["a"]}`)}
	if err := validateReferenceCountInput(&dto, nil); err != nil {
		t.Fatalf("nil model must be a no-op: %v", err)
	}
}
