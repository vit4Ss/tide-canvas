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
		Config:    `{"referenceVideoBillingEnabled":true,"durations":["4s","5s","7s"],"resolutions":["720p"],"priceMatrix":{"4s":{"720p":28},"5s":{"720p":35},"7s":{"720p":49}}}`,
	}

	extra, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil {
		t.Fatal(err)
	}
	// Durations are rounded upward to milliseconds, then each video uses the
	// next configured duration tier independently: 4.201s -> 5s (35 points),
	// 5.010s -> 7s (49 points).
	if extra != 84 {
		t.Fatalf("reference-video cost = %d, want 84", extra)
	}
	if total := resolveCost(m, dto.Input) + extra; total != 119 {
		t.Fatalf("total cost = %d, want 119", total)
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

func TestPrepareReferenceVideoPricingInputCanonicalizesLegacyAlias(t *testing.T) {
	s := &service{confirmVideoDuration: func(_ context.Context, _ idgen.ID, source string) (string, float64, error) {
		if source != "legacy-video" {
			t.Fatalf("unexpected source %q", source)
		}
		return "canonical-video", 7, nil
	}}
	dto := generateDTO{
		Handler: "reference_to_video",
		Input:   json.RawMessage(`{"duration":7,"video_urls":["legacy-video"]}`),
	}
	m := &model.AiModel{Type: "video", Config: `{
		"referenceVideoBillingEnabled":true,
		"durations":["7s"],"resolutions":["720p"],
		"priceMatrix":{"7s":{"720p":49}}
	}`}
	cost, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil || cost != 49 {
		t.Fatalf("legacy alias cost = (%d, %v), want (49, nil)", cost, err)
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatal(err)
	}
	if _, exists := input["video_urls"]; exists {
		t.Fatalf("legacy alias survived canonicalization: %#v", input)
	}
	if input["resolution"] != "720p" || resolveCost(m, dto.Input) != 49 {
		t.Fatalf("single-resolution fallback did not normalize base pricing input: %#v", input)
	}
	refs := inputStrings(input, "videoReferences")
	if len(refs) != 1 || refs[0] != "canonical-video" {
		t.Fatalf("canonical references = %#v", refs)
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
	charge, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"video-7s", "video-8s"}, referenceVideoMatrixPricing{
		resolution: "720p",
		prices: []referenceVideoDurationPrice{
			{duration: 7, points: 49},
			{duration: 8, points: 56},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if charge.DurationSecond != 15 || charge.PointCost != 105 {
		t.Fatalf("charge = %#v, want duration 15 and points 105 (49 + 56)", charge)
	}
}

func TestReferenceVideoMatrixPricingRoundsUpToNextDurationTier(t *testing.T) {
	pricing := referenceVideoMatrixPricing{
		resolution: "720p",
		prices: []referenceVideoDurationPrice{
			{duration: 7, points: 49},
			{duration: 8, points: 56},
		},
	}
	if points, err := pricing.pointsFor(7); err != nil || points != 49 {
		t.Fatalf("7s price = (%d, %v), want (49, nil)", points, err)
	}
	if points, err := pricing.pointsFor(7.001); err != nil || points != 56 {
		t.Fatalf("7.001s price = (%d, %v), want next tier 56", points, err)
	}
	if _, err := pricing.pointsFor(8.001); err == nil {
		t.Fatal("duration beyond the largest configured tier must be rejected")
	}
}

func TestReferenceVideoMatrixPricingUsesConfiguredResolutionAndRejectsUnsafePrice(t *testing.T) {
	m := &model.AiModel{Type: "video", Config: `{
		"durations":["7s","8s"],
		"resolutions":["720p","1080p"],
		"priceMatrix":{"7s":{"720p":49,"1080p":70},"8s":{"720p":56,"1080p":80}}
	}`}
	pricing, err := newReferenceVideoMatrixPricing(m, "1080P")
	if err != nil {
		t.Fatal(err)
	}
	if pricing.resolution != "1080p" || len(pricing.prices) != 2 || pricing.prices[0].points != 70 || pricing.prices[1].points != 80 {
		t.Fatalf("pricing = %#v", pricing)
	}
	if _, err := newReferenceVideoMatrixPricing(m, "4k"); err == nil {
		t.Fatal("a resolution outside the configured model options must be rejected")
	}
	overflow := &model.AiModel{Type: "video", Config: `{
		"durations":["7s"],"resolutions":["720p"],
		"priceMatrix":{"7s":{"720p":1e308}}
	}`}
	if _, err := newReferenceVideoMatrixPricing(overflow, "720p"); err == nil {
		t.Fatal("unsafe matrix point price must be rejected")
	}
}

func TestReferenceVideoMatrixPricingRejectsPartiallyConfiguredResolution(t *testing.T) {
	m := &model.AiModel{Type: "video", Config: `{
		"durations":["7s","8s"],
		"resolutions":["720p"],
		"priceMatrix":{"7s":{"720p":49},"8s":{"720p":0}}
	}`}
	if _, err := newReferenceVideoMatrixPricing(m, "720p"); err == nil {
		t.Fatal("a missing tier must not silently fall through to another duration price")
	}
}

func TestReferenceVideoMatrixPricingDefaultsOnlySingleResolution(t *testing.T) {
	single := &model.AiModel{Type: "video", Config: `{
		"durations":["7s"],"resolutions":["720p"],
		"priceMatrix":{"7s":{"720p":49}}
	}`}
	pricing, err := newReferenceVideoMatrixPricing(single, "")
	if err != nil || pricing.resolution != "720p" {
		t.Fatalf("single-resolution fallback = (%#v, %v), want 720p", pricing, err)
	}
	multiple := &model.AiModel{Type: "video", Config: `{
		"durations":["7s"],"resolutions":["720p","1080p"],
		"priceMatrix":{"7s":{"720p":49,"1080p":70}}
	}`}
	if _, err := newReferenceVideoMatrixPricing(multiple, ""); err == nil {
		t.Fatal("an omitted resolution must be rejected when more than one price column exists")
	}
}

func TestReferenceVideoMatrixPricingFallsBackFromEmptyPriceMatrixAlias(t *testing.T) {
	m := &model.AiModel{Type: "video", Config: `{
		"durations":["7s"],"resolutions":["720p"],"priceMatrix":{},
		"pricing":{"720P":{"7":49}}
	}`}
	pricing, err := newReferenceVideoMatrixPricing(m, "720p")
	if err != nil || len(pricing.prices) != 1 || pricing.prices[0].points != 49 {
		t.Fatalf("legacy pricing fallback = (%#v, %v), want 49 points", pricing, err)
	}
}

func TestQuoteReferenceVideosReportsDisabledBillingAuthoritatively(t *testing.T) {
	db := openPricingTestDB(t)
	row := model.MarketModel{
		BaseModel: model.BaseModel{ID: 102},
		Name:      "Free references",
		ModelKey:  "free-reference-video",
		Type:      "video",
		Status:    1,
		Config:    `{"referenceVideoBillingEnabled":false}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	s := &service{repo: newRepo(db), confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		t.Fatal("disabled billing must not probe reference videos")
		return "", 0, nil
	}}
	quote, err := s.quoteReferenceVideos(context.Background(), 42, referenceVideoQuoteDTO{
		ModelID: "free-reference-video", VideoURLs: []string{"https://cdn.example/video.mp4"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if quote.BillingEnabled || quote.PointCost != 0 || quote.VideoCount != 0 {
		t.Fatalf("disabled quote = %#v", quote)
	}
}

func TestQuoteReferenceVideosRejectsUnsupportedVideoReferences(t *testing.T) {
	db := openPricingTestDB(t)
	row := model.MarketModel{
		BaseModel: model.BaseModel{ID: 104},
		Name:      "No video references",
		ModelKey:  "no-video-references",
		Type:      "video",
		Status:    1,
		Config:    `{"omniRefVideoEnabled":false,"referenceVideoBillingEnabled":true,"durations":["7s"],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":49}}}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	s := &service{repo: newRepo(db), confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		t.Fatal("unsupported reference videos must not be probed")
		return "", 0, nil
	}}
	_, err := s.quoteReferenceVideos(context.Background(), 42, referenceVideoQuoteDTO{
		ModelID: "no-video-references", VideoURLs: []string{"https://cdn.example/video.mp4"},
	})
	if err == nil || !strings.Contains(err.Error(), "不支持参考视频") {
		t.Fatalf("error = %v, want unsupported reference video", err)
	}
}

func TestQuoteReferenceVideosReportsEnabledBillingAndSurcharge(t *testing.T) {
	db := openPricingTestDB(t)
	row := model.MarketModel{
		BaseModel: model.BaseModel{ID: 103},
		Name:      "Paid references",
		ModelKey:  "paid-reference-video",
		Type:      "video",
		Status:    1,
		Config:    `{"referenceVideoBillingEnabled":true,"durations":["7s","8s"],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":49},"8s":{"720p":56}}}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	s := &service{repo: newRepo(db), confirmVideoDuration: func(_ context.Context, _ idgen.ID, source string) (string, float64, error) {
		switch source {
		case "video-7s":
			return "canonical-7s", 7, nil
		case "video-8s":
			return "canonical-8s", 8, nil
		default:
			return "", 0, errors.New("unexpected video")
		}
	}}
	quote, err := s.quoteReferenceVideos(context.Background(), 42, referenceVideoQuoteDTO{
		ModelID: "paid-reference-video", Resolution: "720p", VideoURLs: []string{"video-7s", "video-8s"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !quote.BillingEnabled || quote.VideoCount != 2 || quote.DurationSeconds != 15 || quote.Resolution != "720p" || quote.PointCost != 105 {
		t.Fatalf("enabled quote = %#v", quote)
	}
}

func TestReferenceVideoChargeBillsRepeatedSlotsSeparately(t *testing.T) {
	probes := 0
	s := &service{confirmVideoDuration: func(_ context.Context, _ idgen.ID, source string) (string, float64, error) {
		probes++
		return "canonical-7s", 7, nil
	}}
	charge, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"same-video", "same-video"}, referenceVideoMatrixPricing{
		resolution: "720p",
		prices:     []referenceVideoDurationPrice{{duration: 7, points: 49}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if probes != 1 {
		t.Fatalf("probe count = %d, want 1 for a repeated asset", probes)
	}
	if charge.VideoCount != 2 || charge.DurationSecond != 14 || charge.PointCost != 98 {
		t.Fatalf("charge = %#v, want two separately billed 7s slots", charge)
	}
}

func TestReferenceVideoPointCostRejectsOverflow(t *testing.T) {
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
	_, err := s.confirmReferenceVideoCharge(context.Background(), 42, []string{"https://cdn.example/" + strings.Repeat("a", maxReferenceVideoURLBytes)}, referenceVideoMatrixPricing{
		resolution: "720p", prices: []referenceVideoDurationPrice{{duration: 15, points: 105}},
	})
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
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":false}`}

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

func TestPrepareReferenceVideoPricingInputRequiresMatrixPrice(t *testing.T) {
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		t.Fatal("duration probe ran before rate validation")
		return "", 0, nil
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"resolution":"720p","videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"durations":["5s"],"resolutions":["720p"],"priceMatrix":{}}`}
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
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"durations":["5s"],"resolutions":["720p"],"priceMatrix":{"5s":{"720p":35}}}`}
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
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"resolution":"720p","videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"durations":["5s"],"resolutions":["720p"],"priceMatrix":{"5s":{"720p":35}}}`}
	if _, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m); !errors.Is(err, errVideoProbeUnavailable) {
		t.Fatalf("error = %v, want probe unavailable", err)
	}
}

func TestPrepareReferenceVideoPricingInputRedactsProbeDetails(t *testing.T) {
	const internalDetail = "ffprobe failed at internal-storage: secret-token"
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "", 0, errors.New(internalDetail)
	}}
	dto := generateDTO{Handler: "reference_to_video", Input: json.RawMessage(`{"resolution":"720p","videoReferences":["https://cdn.example/a.mp4"]}`)}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":true,"durations":["5s"],"resolutions":["720p"],"priceMatrix":{"5s":{"720p":35}}}`}
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
