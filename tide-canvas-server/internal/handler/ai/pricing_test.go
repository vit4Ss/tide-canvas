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

// 超分请求的档位键是 targetResolution(不发 resolution/clarity):必须兜底进
// 清晰度轴,后台按目标分辨率配的 default 行才能命中;未配矩阵落模型固定价。
func TestResolveCostUpscaleTargetResolution(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricing":{"default":{"1080p":30,"4k":120}}}`,
	}
	if got := resolveCost(m, json.RawMessage(`{"targetResolution":"4k","videoUrl":"https://x/in.mp4"}`)); got != 120 {
		t.Errorf("targetResolution should hit the default row: got %d, want 120", got)
	}
	if got := resolveCost(m, json.RawMessage(`{"target_resolution":"1080p"}`)); got != 30 {
		t.Errorf("snake_case target_resolution should also hit: got %d, want 30", got)
	}
	// 未配置的档位(上游默认 1080p 但请求未带档位)落模型固定价
	if got := resolveCost(m, json.RawMessage(`{"videoUrl":"https://x/in.mp4"}`)); got != 50 {
		t.Errorf("no resolution should fall back to point cost: got %d, want 50", got)
	}
	// 通用 resolution 键不参与超分计费(与 upscaleParams 同口径,双键并存时
	// 以 targetResolution 为准,计费档=实际提交档)
	if got := resolveCost(m, json.RawMessage(`{"resolution":"1080p","targetResolution":"4k"}`)); got != 120 {
		t.Errorf("targetResolution must win over generic resolution: got %d, want 120", got)
	}
	// 残留的 batchCount 不得放大计费:超分永远单产出
	if got := resolveCost(m, json.RawMessage(`{"targetResolution":"4k","batchCount":4}`)); got != 120 {
		t.Errorf("batchCount must not multiply upscale cost: got %d, want 120", got)
	}
}

func TestResolveCostUpscalePerSecond(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricePerSecond":"1.25","pricing":{"default":{"4k":120}},"creditCost":80}`,
	}

	// 每秒价优先于旧矩阵、覆盖价和模型固定价，且与目标分辨率、batchCount 无关。
	if got := resolveCost(m, json.RawMessage(`{"duration":4.2,"targetResolution":"4k","batchCount":4}`)); got != 6 {
		t.Errorf("per-second price should take precedence and round up: got %d, want 6", got)
	}
	if got := resolveCost(m, json.RawMessage(`{"duration":"4s","targetResolution":"1080p"}`)); got != 5 {
		t.Errorf("string duration should be accepted: got %d, want 5", got)
	}
	m.Config = `{"pricePerSecond":2.5}`
	if got := resolveCost(m, json.RawMessage(`{"duration":4}`)); got != 10 {
		t.Errorf("2.5 points per second × 4 seconds: got %d, want 10", got)
	}

	if cost, configured, valid := resolveUpscaleTimeCost(m, json.RawMessage(`{"targetResolution":"4k"}`)); cost != 0 || !configured || valid {
		t.Errorf("missing duration = (%d, %v, %v), want (0, true, false)", cost, configured, valid)
	}
}

func TestResolveCostUpscalePerSecondKeepsLegacyFallback(t *testing.T) {
	m := &model.AiModel{
		Type:      "upscale",
		PointCost: 50,
		Config:    `{"pricing":{"default":{"4k":120}}}`,
	}
	if cost, configured, valid := resolveUpscaleTimeCost(m, json.RawMessage(`{"targetResolution":"4k"}`)); cost != 0 || configured || valid {
		t.Errorf("legacy model = (%d, %v, %v), want unconfigured", cost, configured, valid)
	}
	if got := resolveCost(m, json.RawMessage(`{"targetResolution":"4k"}`)); got != 120 {
		t.Errorf("legacy matrix price changed: got %d, want 120", got)
	}
	m.Config = `{"pricePerSecond":"","pricing":{"default":{"4k":120}}}`
	if got := resolveCost(m, json.RawMessage(`{"targetResolution":"4k"}`)); got != 120 {
		t.Errorf("blank new field must keep legacy matrix price: got %d, want 120", got)
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
