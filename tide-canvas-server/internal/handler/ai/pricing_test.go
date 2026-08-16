package ai

import (
	"encoding/json"
	"testing"

	"tidecanvas/internal/model"
)

// 锁定容错查表行为：后台矩阵键常为 "4s"/"720p"，客户端参数是数字时长 + "720P"
// 大写——大小写、s 后缀、行列轴序都必须命中，miss 才落模型固定价。
// 回归背景：曾因 duration 数字被 strField 丢弃 + 键格式不匹配，视频计费
// 静默全落固定价（显示与扣费都不随时长/清晰度变化）。
func TestResolveCostVideoFuzzyMatrix(t *testing.T) {
	m := &model.AiModel{
		Type:      "video",
		PointCost: 3150,
		Config:    `{"pricing":{"4s":{"720p":100,"1080p":220},"8s":{"720p":180}}}`,
	}
	cases := []struct {
		name  string
		input string
		want  int
	}{
		{"数字时长+大写清晰度", `{"duration":4,"resolution":"720P"}`, 100},
		{"字符串时长带s", `{"duration":"8s","resolution":"720p"}`, 180},
		{"字符串时长不带s", `{"duration":"4","resolution":"1080p"}`, 220},
		{"矩阵未配置的档位落模型固定价", `{"duration":15,"resolution":"720p"}`, 3150},
	}
	for _, c := range cases {
		if got := resolveCost(m, json.RawMessage(c.input)); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}

func TestResolveCostVideoPerRequestUsesResolutionAndIgnoresDuration(t *testing.T) {
	m := &model.AiModel{
		Type:      "video",
		PointCost: 999,
		Config: `{
			"videoBillingMode":"per_request",
			"resolutions":["720p","1080p"],
			"pricePerRequestByResolution":{"720P":"12.1","1080p":25},
			"priceMatrix":{"4s":{"720p":4},"20s":{"720p":20}},
			"creditCost":88
		}`,
	}
	for _, input := range []string{
		`{"duration":4,"resolution":"720p"}`,
		`{"duration":20,"resolution":"720P"}`,
	} {
		if got := resolveCost(m, json.RawMessage(input)); got != 13 {
			t.Fatalf("per-request 720p cost for %s = %d, want 13", input, got)
		}
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":4,"resolution":"1080P"}`)); got != 25 {
		t.Fatalf("per-request 1080p cost = %d, want 25", got)
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":4,"resolution":"4k"}`)); got != 0 {
		t.Fatalf("unsupported resolution must fail closed, got %d", got)
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":4}`)); got != 0 {
		t.Fatalf("multiple resolutions without an explicit choice must fail closed, got %d", got)
	}

	m.Config = `{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":10,"720P":11},"creditCost":88}`
	if got := resolveCost(m, json.RawMessage(`{"resolution":"720p"}`)); got != 0 {
		t.Fatalf("ambiguous case-variant rates must fail closed, got %d", got)
	}

	m.Config = `{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":"9223372036854775808"}}`
	if got := resolveCost(m, json.RawMessage(`{"resolution":"720p"}`)); got != 0 {
		t.Fatalf("an unsafe point value must fail closed before integer conversion, got %d", got)
	}
}

func TestResolveCostVideoPerRequestSingleResolutionFallback(t *testing.T) {
	m := &model.AiModel{
		Type:   "video",
		Config: `{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":9}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":99}`)); got != 9 {
		t.Fatalf("single-resolution request cost = %d, want 9", got)
	}

	m.Config = `{"videoBillingMode":"duration","resolutions":["720p"],"pricePerRequestByResolution":{"720p":9},"priceMatrix":{"4s":{"720p":4}}}`
	if got := resolveCost(m, json.RawMessage(`{"duration":4,"resolution":"720p"}`)); got != 4 {
		t.Fatalf("switching back must retain and use duration matrix: got %d, want 4", got)
	}
}

func TestPrepareVideoPerRequestPricingInputCanonicalizesProviderResolution(t *testing.T) {
	m := &model.AiModel{
		Type:   "video",
		Config: `{"videoBillingMode":"per_request","resolutions":["720P","1080p"],"pricePerRequestByResolution":{"720p":9,"1080p":15}}`,
	}
	dto := generateDTO{Input: json.RawMessage(`{"clarity":"1080P","duration":20,"prompt":"keep me"}`)}
	configured, valid := prepareVideoPerRequestPricingInput(&dto, m)
	if !configured || !valid {
		t.Fatalf("legacy clarity input should normalize, got configured=%v valid=%v", configured, valid)
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatalf("normalized input is invalid JSON: %v", err)
	}
	if input["resolution"] != "1080p" {
		t.Fatalf("canonical resolution = %#v, want 1080p", input["resolution"])
	}
	if input["clarity"] != "1080P" || input["duration"] != float64(20) || input["prompt"] != "keep me" {
		t.Fatalf("normalization changed unrelated input: %#v", input)
	}
	if got := resolveCost(m, dto.Input); got != 15 {
		t.Fatalf("normalized cost = %d, want 15", got)
	}
	params := (&relayProviderClient{}).videoParams("video-model", "text_to_video", input)
	if params.Resolution != "1080p" {
		t.Fatalf("provider resolution = %q, want 1080p", params.Resolution)
	}
	legacyParams := (&relayProviderClient{}).videoParams(
		"video-model",
		"text_to_video",
		map[string]any{"clarity": "720P"},
	)
	if legacyParams.Resolution != "720p" {
		t.Fatalf("legacy provider resolution = %q, want 720p", legacyParams.Resolution)
	}
}

func TestPrepareVideoPerRequestPricingInputInjectsSoleResolution(t *testing.T) {
	m := &model.AiModel{
		Type:   "video",
		Config: `{"videoBillingMode":"per_request","resolutions":["720P"],"pricePerRequestByResolution":{"720p":9}}`,
	}
	dto := generateDTO{Input: json.RawMessage(`{"duration":99}`)}
	configured, valid := prepareVideoPerRequestPricingInput(&dto, m)
	if !configured || !valid {
		t.Fatalf("sole resolution fallback should normalize, got configured=%v valid=%v", configured, valid)
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatalf("normalized input is invalid JSON: %v", err)
	}
	if input["resolution"] != "720P" {
		t.Fatalf("canonical resolution = %#v, want 720P", input["resolution"])
	}
	if got := resolveCost(m, dto.Input); got != 9 {
		t.Fatalf("normalized cost = %d, want 9", got)
	}
	params := (&relayProviderClient{}).videoParams("video-model", "text_to_video", input)
	if params.Resolution != "720p" {
		t.Fatalf("provider resolution = %q, want 720p", params.Resolution)
	}
}

func TestResolveCostMatrixAliasPriorityAndEmptyFallback(t *testing.T) {
	legacyFallback := &model.AiModel{
		Type:      "video",
		PointCost: 999,
		Config:    `{"priceMatrix":{},"pricing":{"7s":{"720p":49}}}`,
	}
	if got := resolveCost(legacyFallback, json.RawMessage(`{"duration":7,"resolution":"720P"}`)); got != 49 {
		t.Fatalf("empty priceMatrix should fall back to pricing: got %d, want 49", got)
	}
	newPriority := &model.AiModel{
		Type:      "video",
		PointCost: 999,
		Config:    `{"priceMatrix":{"7s":{"720p":70}},"pricing":{"7s":{"720p":49}}}`,
	}
	if got := resolveCost(newPriority, json.RawMessage(`{"duration":7,"resolution":"720P"}`)); got != 70 {
		t.Fatalf("non-empty priceMatrix must win over stale pricing alias: got %d, want 70", got)
	}
}

// 图片矩阵（画质×清晰度）的大小写容错：内置清晰度 "2K" 大写 vs 后台小写键。
func TestResolveCostImageFuzzyMatrix(t *testing.T) {
	m := &model.AiModel{
		Type:      "image",
		PointCost: 18,
		Config:    `{"pricing":{"high":{"2k":30,"4k":60}}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"quality":"high","clarity":"2K"}`)); got != 30 {
		t.Errorf("uppercase clarity should hit lowercase matrix key: got %d, want 30", got)
	}
	// upscale 走 high/4k + 批量 1；未命中档位落固定价
	if got := resolveCost(m, json.RawMessage(`{"quality":"high","clarity":"8k"}`)); got != 18 {
		t.Errorf("miss should fall back to model point cost: got %d, want 18", got)
	}
}

func TestResolveCostUpscaleRequiresResolutionRate(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricing":{"default":{"1080p":30,"4k":120}}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":10,"targetResolution":"4k"}`)); got != 0 {
		t.Errorf("legacy matrix/fixed price must not bill upscale: got %d, want 0", got)
	}
}

func TestResolveCostUpscalePerResolutionSecond(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricePerSecondByResolution":{"1080p":"1.25","4K":2.5},"pricePerSecond":9,"pricing":{"default":{"4k":120}},"creditCost":80}`,
	}

	if got := resolveCost(m, json.RawMessage(`{"duration":4.2,"targetResolution":"4k","batchCount":4}`)); got != 11 {
		t.Errorf("4k rate should be selected and rounded up: got %d, want 11", got)
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":"4s","targetResolution":"1080p"}`)); got != 5 {
		t.Errorf("string duration should be accepted: got %d, want 5", got)
	}
	if got := resolveUpscalePointRate(m, "4k"); got != 2.5 {
		t.Errorf("resolution rate = %v, want 2.5", got)
	}

	if cost, configured, valid := resolveUpscaleTimeCost(m, json.RawMessage(`{"targetResolution":"4k"}`)); cost != 0 || !configured || valid {
		t.Errorf("missing duration = (%d, %v, %v), want (0, true, false)", cost, configured, valid)
	}
	if cost, configured, valid := resolveUpscaleTimeCost(m, json.RawMessage(`{"duration":4,"targetResolution":"2k"}`)); cost != 0 || configured || valid {
		t.Errorf("unpriced resolution = (%d, %v, %v), want (0, false, false)", cost, configured, valid)
	}
}

func TestResolveCostUpscaleKeepsUniformPerSecondRollingFallback(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricePerSecond":"1.25","pricing":{"default":{"4k":120}}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":4.2,"targetResolution":"4k"}`)); got != 6 {
		t.Errorf("uniform rolling fallback: got %d, want 6", got)
	}
}

// 图片模型不配画质档位时，矩阵以「default」单行按清晰度定价（画质留空的
// 兼容形态）；请求带画质时不吃 default 行，行为与原先一致。
func TestResolveCostImageDefaultQualityRow(t *testing.T) {
	m := &model.AiModel{
		Type:      "image",
		PointCost: 18,
		Config:    `{"pricing":{"default":{"1k":8,"2k":14}}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"clarity":"2K"}`)); got != 14 {
		t.Errorf("empty quality should hit the default row: got %d, want 14", got)
	}
	// 批量与 default 行组合：×batchCount 向上取整
	if got := resolveCost(m, json.RawMessage(`{"clarity":"1k","batchCount":3}`)); got != 24 {
		t.Errorf("default row × batch: got %d, want 24", got)
	}
	// 显式画质不吃 default 行 → 未命中落固定价（原有语义不变）
	if got := resolveCost(m, json.RawMessage(`{"quality":"high","clarity":"2k"}`)); got != 18 {
		t.Errorf("explicit quality must not hit default row: got %d, want 18", got)
	}
}
