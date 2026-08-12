package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestPrepareUpscalePricingInputOverridesClientDuration(t *testing.T) {
	s := &service{confirmUpscaleDuration: func(_ context.Context, userID idgen.ID, source string) (string, float64, error) {
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

func TestPrepareUpscalePricingInputRejectsUnpricedResolution(t *testing.T) {
	called := false
	s := &service{confirmUpscaleDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
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
	s := &service{confirmUpscaleDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
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
		confirmUpscaleDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
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
