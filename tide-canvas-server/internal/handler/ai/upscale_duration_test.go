package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestCappedProbeBufferRetainsBoundedPrefix(t *testing.T) {
	buffer := cappedProbeBuffer{limit: 5}
	if n, err := buffer.Write([]byte("1234567")); err != nil || n != 7 {
		t.Fatalf("first write = (%d, %v), want (7, nil)", n, err)
	}
	if n, err := buffer.Write([]byte("89")); err != nil || n != 2 {
		t.Fatalf("second write = (%d, %v), want (2, nil)", n, err)
	}
	if got := buffer.String(); got != "12345" {
		t.Fatalf("buffer = %q, want bounded prefix", got)
	}
}

func TestConfirmedProbeDurationUsesLongestVideoBoundary(t *testing.T) {
	got, err := confirmedProbeDuration([]byte(`{
		"streams":[{"duration":"7.001"},{"duration":"8.25"}],
		"format":{"duration":"8.10"}
	}`))
	if err != nil || got != 8.25 {
		t.Fatalf("duration = (%v, %v), want (8.25, nil)", got, err)
	}
	got, err = confirmedProbeDuration([]byte(`{"streams":[{}],"format":{"duration":"5.5"}}`))
	if err != nil || got != 5.5 {
		t.Fatalf("format fallback = (%v, %v), want (5.5, nil)", got, err)
	}
	for _, raw := range []string{
		`{"streams":[],"format":{"duration":"5"}}`,
		`{"streams":[{"duration":"N/A"}],"format":{"duration":"N/A"}}`,
		`not-json`,
	} {
		if _, err := confirmedProbeDuration([]byte(raw)); err == nil {
			t.Fatalf("invalid probe output accepted: %s", raw)
		}
	}
}

func TestPrepareUpscalePricingInputOverridesClientDuration(t *testing.T) {
	s := &service{confirmVideoDuration: func(_ context.Context, userID idgen.ID, source string) (string, float64, error) {
		if userID != 42 || source != "https://cdn.example/input.mp4" {
			t.Fatalf("confirmer input = %s/%s", userID, source)
		}
		return "https://cdn.example/canonical.mp4", 4.2001, nil
	}}
	dto := generateDTO{Input: json.RawMessage(`{"videoUrl":"https://cdn.example/input.mp4","targetResolution":"4K","duration":1}`)}
	m := &model.AiModel{Type: "upscale", Config: `{"pricePerSecondByResolution":{"4k":2.5}}`}

	if err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m); err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatal(err)
	}
	if input["videoUrl"] != "https://cdn.example/canonical.mp4" || input["targetResolution"] != "4k" {
		t.Fatalf("normalized input = %#v", input)
	}
	if got := durationSeconds(input["duration"]); got != 4.201 {
		t.Fatalf("confirmed duration = %v, want 4.201", got)
	}
	if got := resolveCost(m, dto.Input); got != 11 {
		t.Fatalf("confirmed cost = %d, want 11", got)
	}
}

func TestPrepareUpscalePricingInputRejectsInvalidOptionsBeforeProbe(t *testing.T) {
	cases := []struct{ name, input, want string }{
		{"invalid fps", `{"outputFps":"5x"}`, "输出帧率"},
		{"invalid numeric fps", `{"output_fps":61}`, "输出帧率"},
		{"invalid fps type", `{"outputFps":true,"extras":{"output_fps":"1x"}}`, "输出帧率"},
		{"invalid level", `{"upscaleModel":"ultra"}`, "增强档位"},
		{"invalid level type", `{"upscaleModel":1,"extras":{"upscale_model":"max"}}`, "增强档位"},
		{"empty explicit level", `{"upscale_model":"","extras":{"upscale_model":"max"}}`, "增强档位"},
		{"invalid extras", `{"extras":[]}`, "必须是对象"},
		{"invalid legacy level", `{"extras":{"upscale_model":false}}`, "增强档位"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
				t.Fatal("invalid options reached duration probing")
				return "", 0, nil
			}}
			var input map[string]any
			if err := json.Unmarshal([]byte(tc.input), &input); err != nil {
				t.Fatal(err)
			}
			input["videoUrl"] = "https://cdn.example/source.mp4"
			input["targetResolution"] = "4k"
			raw, _ := json.Marshal(input)
			dto := generateDTO{Input: raw}
			m := &model.AiModel{ModelID: "rh-upscale", Type: "upscale", Config: `{"pricePerSecondByResolution":{"4k":2.5}}`}
			var placement skillPlacementError
			err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m)
			if !errors.As(err, &placement) || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want placement error containing %q", err, tc.want)
			}
		})
	}
}

func TestPrepareUpscalePricingInputNormalizesRHOptions(t *testing.T) {
	for _, input := range []string{
		`{"output_fps":59.94,"upscale_model":" HIGH "}`,
		`{"extras":{"output_fps":59.94,"upscale_model":"HIGH"}}`,
		`{"outputFps":59.94,"upscaleModel":"high","extras":{"output_fps":"invalid","upscale_model":1}}`,
	} {
		s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
			return "https://cdn.example/source.mp4", 10, nil
		}}
		var payload map[string]any
		if err := json.Unmarshal([]byte(input), &payload); err != nil {
			t.Fatal(err)
		}
		payload["videoUrl"] = "https://cdn.example/source.mp4"
		payload["targetResolution"] = "4k"
		raw, _ := json.Marshal(payload)
		dto := generateDTO{Input: raw}
		m := &model.AiModel{ModelID: "rh-upscale", Type: "upscale", Config: `{"pricePerSecondByResolution":{"4k":2.5}}`}
		if err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m); err != nil {
			t.Fatal(err)
		}
		var normalized map[string]any
		if err := json.Unmarshal(dto.Input, &normalized); err != nil {
			t.Fatal(err)
		}
		if normalized["outputFps"] != "59.94" || normalized["upscaleModel"] != "high" || normalized["extras"] != nil || normalized["output_fps"] != nil || normalized["upscale_model"] != nil {
			t.Fatalf("normalized input = %+v", normalized)
		}
	}
}

func TestPrepareUpscalePricingInputRejectsUnsupportedResolutionBeforeProbe(t *testing.T) {
	for _, tc := range []struct{ model, resolution string }{
		{"rh-upscale", "8k"}, {"bytedance/video-upscaler", "720p"},
	} {
		s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
			t.Fatal("unsupported resolution reached duration probing")
			return "", 0, nil
		}}
		dto := generateDTO{Input: json.RawMessage(`{"videoUrl":"https://cdn.example/source.mp4","targetResolution":"` + tc.resolution + `"}`)}
		m := &model.AiModel{ModelID: tc.model, Type: "upscale", Config: `{"pricePerSecondByResolution":{"720p":1,"8k":3}}`}
		if err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m); err == nil {
			t.Fatalf("accepted %s/%s", tc.model, tc.resolution)
		}
	}
}

func TestPrepareUpscalePricingInputRejectsUnpricedResolution(t *testing.T) {
	called := false
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		called = true
		return "", 0, nil
	}}
	dto := generateDTO{Input: json.RawMessage(`{"videoUrl":"https://cdn.example/input.mp4","targetResolution":"2k"}`)}
	m := &model.AiModel{Type: "upscale", Config: `{"pricePerSecondByResolution":{"4k":2.5}}`}
	if err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m); err == nil {
		t.Fatal("expected unpriced resolution rejection")
	}
	if called {
		t.Fatal("duration probe ran before price validation")
	}
}

func TestResolveUpscalePointRateRequiresResolution(t *testing.T) {
	m := &model.AiModel{Type: "upscale", Config: `{"pricePerSecond":2.5}`}
	if got := resolveUpscalePointRate(m, ""); got != 0 {
		t.Fatalf("missing resolution inherited legacy rate: %v", got)
	}
}

func TestPrepareUpscalePricingInputSurfacesProbeUnavailable(t *testing.T) {
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "", 0, errVideoProbeUnavailable
	}}
	dto := generateDTO{Input: json.RawMessage(`{"videoUrl":"https://cdn.example/input.mp4","targetResolution":"4k"}`)}
	m := &model.AiModel{Type: "upscale", Config: `{"pricePerSecondByResolution":{"4k":2.5}}`}
	if err := s.prepareUpscalePricingInput(context.Background(), 42, &dto, m); !errors.Is(err, errVideoProbeUnavailable) {
		t.Fatalf("error = %v, want probe unavailable", err)
	}
}

func TestQuoteUpscaleReturnsConfirmedDurationAndCost(t *testing.T) {
	db := openPricingTestDB(t)
	row := model.MarketModel{
		BaseModel: model.BaseModel{ID: 101},
		Name:      "Upscaler",
		ModelKey:  "upscale-1",
		Type:      "upscale",
		Status:    1,
		Config:    `{"pricePerSecondByResolution":{"4k":2.5}}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	s := &service{
		repo: newRepo(db),
		confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
			return "https://cdn.example/canonical.mp4", 4.2, nil
		},
	}
	quote, err := s.quoteUpscale(context.Background(), 42, upscaleQuoteDTO{
		ModelID: "upscale-1", VideoURL: "https://cdn.example/input.mp4", TargetResolution: "4K",
	})
	if err != nil {
		t.Fatal(err)
	}
	if quote.DurationSeconds != 4.2 || quote.RatePerSecond != 2.5 || quote.PointCost != 11 || quote.Resolution != "4k" {
		t.Fatalf("quote = %#v", quote)
	}
}

// Kept local to these quote tests so pricing's pure unit tests remain DB-free.
func openPricingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Skipf("sqlite unavailable: %v", err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	return db
}
