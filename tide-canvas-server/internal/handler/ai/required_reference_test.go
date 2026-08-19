package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/pkg/idgen"
)

func TestValidateRequiredReferenceInput(t *testing.T) {
	tests := []struct {
		name    string
		handler string
		entry   string
		project idgen.ID
		input   string
		wantErr string
	}{
		{name: "missing input", handler: "image_to_image", wantErr: "图生图必须上传参考图片"},
		{name: "missing reference fields", handler: "image_to_image", input: `{"prompt":"edit it"}`, wantErr: "图生图必须上传参考图片"},
		{name: "blank references", handler: "image_to_image", input: `{"imageList":["  "],"sourceImage":""}`, wantErr: "图生图必须上传参考图片"},
		{name: "image list", handler: "image_to_image", input: `{"imageList":["https://cdn.example/ref.png"]}`},
		{name: "source image", handler: " IMAGE_TO_IMAGE ", input: `{"sourceImage":"https://cdn.example/ref.png"}`},
		{name: "image to video missing source", handler: "image_to_video", input: `{"prompt":"animate it"}`, wantErr: "图生视频必须上传首帧图片"},
		{name: "image to video source image", handler: "image_to_video", input: `{"sourceImage":"https://cdn.example/first.png"}`},
		{name: "start end missing both", handler: "start_end_to_video", input: `{"prompt":"transition"}`, wantErr: "首尾帧模式需要上传首帧"},
		{name: "start end missing last", handler: "start_end_to_video", input: `{"firstFrame":"https://cdn.example/first.png"}`, wantErr: "首尾帧模式需要上传尾帧"},
		{name: "start end single ordered image", handler: "start_end_to_video", input: `{"imageList":["https://cdn.example/first.png"]}`, wantErr: "首尾帧模式需要上传尾帧"},
		{name: "discrete first does not borrow list tail", handler: "start_end_to_video", input: `{"firstFrame":"https://cdn.example/first.png","imageList":["https://cdn.example/first.png","https://cdn.example/last.png"]}`, wantErr: "首尾帧模式需要上传尾帧"},
		{name: "start end missing first", handler: "start_end_to_video", input: `{"lastFrame":"https://cdn.example/last.png"}`, wantErr: "首尾帧模式需要上传首帧"},
		{name: "canvas start end reuses first as last", handler: "start_end_to_video", entry: "canvas", project: 1, input: `{"firstFrame":"https://cdn.example/first.png"}`},
		{name: "canvas ordered single frame", handler: "start_end_to_video", entry: " CANVAS ", project: 1, input: `{"imageList":["https://cdn.example/first.png"]}`},
		{name: "canvas marker without project stays strict", handler: "start_end_to_video", entry: "canvas", input: `{"firstFrame":"https://cdn.example/first.png"}`, wantErr: "首尾帧模式需要上传尾帧"},
		{name: "studio project stays strict", handler: "start_end_to_video", entry: "studio", project: 1, input: `{"firstFrame":"https://cdn.example/first.png"}`, wantErr: "首尾帧模式需要上传尾帧"},
		{name: "canvas start end still requires first", handler: "start_end_to_video", entry: "canvas", project: 1, input: `{"prompt":"transition"}`, wantErr: "首尾帧模式需要上传首帧"},
		{name: "start end discrete fields", handler: "start_end_to_video", input: `{"firstFrame":"https://cdn.example/first.png","lastFrame":"https://cdn.example/last.png"}`},
		{name: "start end ordered list", handler: "start_end_to_video", input: `{"imageList":["https://cdn.example/first.png","https://cdn.example/last.png"]}`},
		{name: "omni reference missing assets", handler: "reference_to_video", input: `{"prompt":"animate it"}`, wantErr: "全能参考必须上传至少一个参考素材"},
		{name: "omni reference blank media", handler: "reference_to_video", input: `{"videoReferences":["  "],"audioReferences":[""]}`, wantErr: "全能参考必须上传至少一个参考素材"},
		{name: "omni reference image", handler: "reference_to_video", input: `{"imageList":["https://cdn.example/ref.png"]}`},
		{name: "omni reference video", handler: "reference_to_video", input: `{"videoReferences":["https://cdn.example/ref.mp4"]}`},
		{name: "omni reference audio alias", handler: "reference_to_video", input: `{"audio_urls":["https://cdn.example/ref.mp3"]}`},
		{name: "other handler unaffected", handler: "text_to_image", input: `{"prompt":"draw it"}`},
		{name: "malformed required input fails closed", handler: "image_to_video", input: `{`, wantErr: "图生视频必须上传首帧图片"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dto := generateDTO{
				Handler: tt.handler, EntryPoint: tt.entry, ProjectID: tt.project,
				Input: json.RawMessage(tt.input),
			}
			err := validateRequiredReferenceInput(&dto)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
		})
	}
}
