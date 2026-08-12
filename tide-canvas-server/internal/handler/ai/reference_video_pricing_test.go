package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestPrepareReferenceVideoPricingInputAddsConfirmedCharge(t *testing.T) {
	s := &service{confirmVideoDuration: func(_ context.Context, userID idgen.ID, source string) (string, float64, error) {
		if userID != 42 {
			t.Fatalf("userID = %s, want 42", userID)
		}
		switch source {
		case "https://cdn.example/a.mp4":
			return "https://cdn.example/canonical-a.mp4", 4.2001, nil
		case "https://cdn.example/b.mp4":
			return "https://cdn.example/canonical-b.mp4", 5.0091, nil
		default:
			t.Fatalf("unexpected source %q", source)
			return "", 0, nil
		}
	}}
	dto := generateDTO{
		Handler: "reference_to_video",
		Input: json.RawMessage(`{
			"duration":5,
			"resolution":"720p",
			"videoReferences":["https://cdn.example/a.mp4","https://cdn.example/b.mp4"],
			"_billing":{"referenceVideoDurationSeconds":0.001,"referenceVideoPointCost":1}
		}`),
	}
	m := &model.AiModel{
		Type:      "video",
		PointCost: 20,
		Config:    `{"referenceVideoBillingEnabled":true,"referenceVideoPricePerSecond":"10"}`,
	}

	extra, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil {
		t.Fatal(err)
	}
	// Durations are rounded upward to milliseconds and billed separately:
	// ceil(4.201 * 10) + ceil(5.010 * 10) = 43 + 51 = 94.
	if extra != 94 {
		t.Fatalf("reference-video cost = %d, want 94", extra)
	}
	if total := resolveCost(m, dto.Input) + extra; total != 114 {
		t.Fatalf("total cost = %d, want 114", total)
	}

	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatal(err)
	}
	refs := inputStrings(input, "videoReferences")
	if len(refs) != 2 || refs[0] != "https://cdn.example/canonical-a.mp4" || refs[1] != "https://cdn.example/canonical-b.mp4" {
		t.Fatalf("canonical references = %#v", refs)
	}
	if _, exists := input[referenceVideoBillingKey]; exists {
		t.Fatalf("server billing metadata must not enter user-visible task input: %#v", input[referenceVideoBillingKey])
	}
}

func TestReferenceVideoChargeSumsEachVideoPrice(t *testing.T) {
	s := &service{confirmVideoDuration: func(_ context.Context, _ idgen.ID, source string) (string, float64, error) {
		switch source {
		case "video-7s":
			return "canonical-7s", 7, nil
		case "video-8s":
			return "canonical-8s", 8, nil
		default:
			return "", 0, errors.New("unexpected video")
		}
	}}
	charge, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"video-7s", "video-8s"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if charge.DurationSecond != 15 || charge.PointCost != 150 {
		t.Fatalf("charge = %#v, want duration 15 and points 150 (70 + 80)", charge)
	}
}

func TestReferenceVideoChargeBillsRepeatedSlotsSeparately(t *testing.T) {
	probes := 0
	s := &service{confirmVideoDuration: func(_ context.Context, _ idgen.ID, source string) (string, float64, error) {
		probes++
		return "canonical-7s", 7, nil
	}}
	charge, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"same-video", "same-video"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if probes != 1 {
		t.Fatalf("probe count = %d, want 1 for a repeated asset", probes)
	}
	if charge.VideoCount != 2 || charge.DurationSecond != 14 || charge.PointCost != 140 {
		t.Fatalf("charge = %#v, want two separately billed 7s slots", charge)
	}
}

func TestReferenceVideoPointCostRejectsOverflow(t *testing.T) {
	if _, err := referenceVideoPoints(1e308, 10); err == nil {
		t.Fatal("expected overflowing reference-video cost to be rejected")
	}
	if _, err := combineGenerationPointCost(maxPointCost(), 1); err == nil {
		t.Fatal("expected overflowing total generation cost to be rejected")
	}
}

func TestReferenceVideoChargeRejectsOversizedURLBeforeProbe(t *testing.T) {
	called := false
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		called = true
		return "", 0, nil
	}}
	_, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"https://cdn.example/" + strings.Repeat("a", maxReferenceVideoURLBytes)}, 10)
	if err == nil {
		t.Fatal("expected oversized reference-video URL rejection")
	}
	if called {
		t.Fatal("oversized URL reached duration probe")
	}
}

func TestPrepareReferenceVideoPricingInputDisabledDoesNotProbeAndStripsClientReceipt(t *testing.T) {
	called := false
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		called = true
		return "", 0, nil
	}}
	dto := generateDTO{
		Handler: "reference_to_video",
		Input:   json.RawMessage(`{"videoReferences":["https://cdn.example/a.mp4"],"_billing":{"referenceVideoPointCost":1}}`),
	}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":false,"referenceVideoPricePerSecond":10}`}

	extra, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil || extra != 0 {
		t.Fatalf("disabled pricing = (%d, %v), want (0, nil)", extra, err)
	}
	if called {
		t.Fatal("disabled reference-video pricing probed the video")
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatal(err)
	}
	if _, exists := input[referenceVideoBillingKey]; exists {
		t.Fatalf("client billing receipt was retained: %#v", input[referenceVideoBillingKey])
	}
}

func TestPrepareReferenceVideoPricingInputRequiresPositiveRate(t *testing.T) {
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		t.Fatal("duration probe ran before rate validation")
		return "", 0, nil
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"referenceVideoPricePerSecond":0}`}
	if _, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m); err == nil {
		t.Fatal("expected invalid reference-video rate rejection")
	}
}

func TestPrepareReferenceVideoPricingInputEnabledWithoutReferencesDoesNotCharge(t *testing.T) {
	called := false
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		called = true
		return "", 0, nil
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"references":["https://cdn.example/a.png"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"referenceVideoPricePerSecond":10}`}
	extra, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil || extra != 0 {
		t.Fatalf("no-reference pricing = (%d, %v), want (0, nil)", extra, err)
	}
	if called {
		t.Fatal("duration probe ran without reference videos")
	}
}

func TestPrepareReferenceVideoPricingInputSurfacesProbeUnavailable(t *testing.T) {
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "", 0, errVideoProbeUnavailable
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"referenceVideoPricePerSecond":10}`}
	if _, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m); !errors.Is(err, errVideoProbeUnavailable) {
		t.Fatalf("error = %v, want probe unavailable", err)
	}
}

func TestPrepareReferenceVideoPricingInputRedactsProbeDetails(t *testing.T) {
	const internalDetail = "ffprobe failed at internal-storage: secret-token"
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "", 0, errors.New(internalDetail)
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"referenceVideoPricePerSecond":10}`}
	_, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err == nil {
		t.Fatal("expected reference-video probe failure")
	}
	if strings.Contains(err.Error(), internalDetail) || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("internal probe detail escaped into user-facing error: %v", err)
	}
	var placement skillPlacementError
	if !errors.As(err, &placement) {
		t.Fatalf("error type = %T, want user-facing placement error", err)
	}
}
