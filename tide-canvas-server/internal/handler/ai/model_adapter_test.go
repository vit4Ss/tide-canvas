package ai

import (
	"encoding/json"
	"reflect"
	"testing"

	"tidecanvas/internal/model"
)

func TestMarketSupportedHandlersUsesRelayVideoModes(t *testing.T) {
	tests := []struct {
		name string
		typ  string
		cfg  string
		want []string
	}{
		{
			name: "live relay schema wins over stale presentation modes",
			typ:  "video",
			cfg:  `{"modes":["t2v"],"paramsSchema":{"modes":["omni_ref"]}}`,
			want: []string{"reference_to_video"},
		},
		{
			name: "all canonical video modes",
			typ:  "video",
			cfg:  `{"paramsSchema":{"modes":["t2v","i2v","keyframe","multi_ref"]}}`,
			want: []string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"},
		},
		{
			name: "capability fallback",
			typ:  "video",
			cfg:  `{"capabilities":["reference-image-to-video"]}`,
			want: []string{"reference_to_video"},
		},
		{
			name: "explicit handlers",
			typ:  "video",
			cfg:  `{"supportedHandlers":["image_to_video"]}`,
			want: []string{"image_to_video"},
		},
		{
			name: "unknown metadata stays backward compatible",
			typ:  "video",
			cfg:  `{"operations":["generation"]}`,
			want: nil,
		},
		{
			name: "non-video inference is unchanged",
			typ:  "image",
			cfg:  `{"modes":["t2i"]}`,
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseHandlers(marketSupportedHandlers(tt.typ, tt.cfg))
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("handlers = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMarketToAiModelPublishesDerivedHandlers(t *testing.T) {
	got := marketToAiModel(&model.MarketModel{
		Type:   "video",
		Config: `{"paramsSchema":{"modes":["omni_ref"]}}`,
		Status: marketModelListed,
	})
	if !got.Enabled {
		t.Fatal("listed market model must remain enabled")
	}
	if handlers := parseHandlers(got.SupportedHandlers); !reflect.DeepEqual(handlers, []string{"reference_to_video"}) {
		t.Fatalf("supported handlers = %v", handlers)
	}
	if modelSupportsHandler(&got, "text_to_video") {
		t.Fatal("reference-only model accepted text-to-video")
	}
	if !modelSupportsHandler(&got, "reference_to_video") {
		t.Fatal("reference-only model rejected reference-to-video")
	}
}

func TestModelVideoDurationAllowedUsesOnlyAdminConfig(t *testing.T) {
	m := &model.AiModel{Config: `{
		"durations":["4s","5s","6s","7s","8s","9s","10s","11s","12s","13s","14s","15s"],
		"paramsSchema":{"duration":["5s","10s"]}
	}`}

	requested, configured, allowed := modelVideoDurationAllowed(m, "text_to_video", json.RawMessage(`{"duration":8}`))
	if requested != 8 || !configured || !allowed {
		t.Fatalf("8 second admin support = (%v, %v, %v), want (8, true, true)", requested, configured, allowed)
	}
	requested, configured, allowed = modelVideoDurationAllowed(m, "text_to_video", json.RawMessage(`{"duration":16}`))
	if requested != 16 || !configured || allowed {
		t.Fatalf("16 second admin support = (%v, %v, %v), want (16, true, false)", requested, configured, allowed)
	}

	legacyNumeric := &model.AiModel{Config: `{"durations":[8,"10s"]}`}
	requested, configured, allowed = modelVideoDurationAllowed(legacyNumeric, "text_to_video", json.RawMessage(`{"duration":"8s"}`))
	if requested != 8 || !configured || !allowed {
		t.Fatalf("numeric admin duration = (%v, %v, %v), want (8, true, true)", requested, configured, allowed)
	}

	relayOnly := &model.AiModel{Config: `{"paramsSchema":{"duration":["8s"]}}`}
	requested, configured, allowed = modelVideoDurationAllowed(relayOnly, "text_to_video", json.RawMessage(`{"duration":8}`))
	if requested != 8 || configured || !allowed {
		t.Fatalf("relay-only duration = (%v, %v, %v), want (8, false, true)", requested, configured, allowed)
	}
}
