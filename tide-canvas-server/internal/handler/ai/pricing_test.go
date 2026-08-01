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
