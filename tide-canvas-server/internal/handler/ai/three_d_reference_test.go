package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidate3DReferenceInput(t *testing.T) {
	modelWithLimit := &model.AiModel{Config: `{"max3DMultiViewImages":2}`}
	tests := []struct {
		name    string
		input   map[string]any
		wantErr string
	}{
		{name: "prompt", input: map[string]any{"prompt": "a dog"}},
		{name: "single image", input: map[string]any{"imageUrl": "https://cdn/dog.png"}},
		{name: "multi-view", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "https://cdn/front.png"},
			map[string]any{"viewType": "back", "viewImageBase64": "data"},
		}}},
		{name: "missing", input: map[string]any{}, wantErr: "需要填写提示词"},
		{name: "conflicting modes", input: map[string]any{
			"prompt": "dog", "imageUrl": "https://cdn/dog.png",
		}, wantErr: "一次只能使用"},
		{name: "prompt and multi-view", input: map[string]any{
			"prompt": "dog", "multiViewImages": []any{
				map[string]any{"viewType": "front", "viewImageUrl": "1"},
			},
		}, wantErr: "一次只能使用"},
		{name: "single image and multi-view", input: map[string]any{
			"imageUrl": "single", "multiViewImages": []any{
				map[string]any{"viewType": "front", "viewImageUrl": "1"},
			},
		}, wantErr: "一次只能使用"},
		{name: "too many", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "1"},
			map[string]any{"viewType": "left", "viewImageUrl": "2"},
			map[string]any{"viewType": "right", "viewImageUrl": "3"},
		}}, wantErr: "最多支持上传 2 张"},
		{name: "duplicate", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "1"},
			map[string]any{"viewType": "front", "viewImageUrl": "2"},
		}}, wantErr: "视角重复"},
		{name: "invalid view", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "side", "viewImageUrl": "1"},
		}}, wantErr: "无效视角"},
		{name: "missing image", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "front"},
		}}, wantErr: "必须且只能包含一张图片"},
		{name: "two image sources", input: map[string]any{"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "1", "viewImageBase64": "2"},
		}}, wantErr: "必须且只能包含一张图片"},
		{name: "malformed list", input: map[string]any{"multiViewImages": "bad"}, wantErr: "参数格式无效"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.input)
			if err != nil {
				t.Fatal(err)
			}
			err = validate3DReferenceInput(&generateDTO{Handler: "generate_3d", Input: raw}, modelWithLimit)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want substring %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidate3DReferenceInputIgnoresOtherHandlers(t *testing.T) {
	if err := validate3DReferenceInput(&generateDTO{Handler: "text_to_image"}, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidate3DReferenceInputAllowsMarbleImageWithTextGuidance(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"prompt":   "保留石板路和暖色灯光",
		"imageUrl": "https://cdn.example.com/street.jpg",
	})
	if err != nil {
		t.Fatal(err)
	}
	marble := &model.AiModel{ModelID: "marble-1.1", Config: `{"provider":"worldlabs"}`}
	if err := validate3DReferenceInput(&generateDTO{Handler: "generate_3d", Input: raw}, marble); err != nil {
		t.Fatalf("Marble image guidance should be valid: %v", err)
	}
}

func TestValidate3DReferenceInputRejectsMarbleInlineMultiImageBeforeCharging(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageBase64": "aGVsbG8="},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	marble := &model.AiModel{ModelID: "marble-1.1", Config: `{"provider":"worldlabs"}`}
	err = validate3DReferenceInput(&generateDTO{Handler: "generate_3d", Input: raw}, marble)
	if err == nil || !strings.Contains(err.Error(), "Base64") {
		t.Fatalf("error = %v", err)
	}
}
