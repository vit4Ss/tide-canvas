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
