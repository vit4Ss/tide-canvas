package ai

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"tidecanvas/internal/model"
)

// pricing.go computes the authoritative point cost of a generation server-side.
// The frontend (points.ts applyTeamFactor + the model's price matrix) only
// renders an estimate; this is the value the balance is actually charged
// against. Resolution order, per generation:
//
//	1. price matrix (config priceMatrix, aliased to pricing): spec-indexed unit
//	   price. image = [quality][clarity], video = [duration][resolution]. Looked
//	   up in BOTH axis orders so either admin authoring orientation resolves.
//	2. priceModifiers "duration@<res>"[duration] (video add-on tables).
//	3. config creditCost (model-level flat override).
//	4. model.PointCost (= MarketModel.Price integer part).
//
// The base is then ×batchCount for images and ×team price factor (ceil),
// mirroring the frontend applyTeamFactor so 所见 ≈ 所扣.

// resolveCost returns the points to charge for one generation of model m given
// the raw generate input and the caller's team price factor (>=1).
func resolveCost(m *model.AiModel, rawInput json.RawMessage, factor float64) int {
	in := map[string]any{}
	if len(rawInput) > 0 {
		_ = json.Unmarshal(rawInput, &in)
	}
	var cfg map[string]any
	if m.Config != "" {
		_ = json.Unmarshal([]byte(m.Config), &cfg)
	}

	// Suno 上传参考音频(extras.task == "upload"):本地音频延长/翻唱前的登记
	// 任务,单曲、非完整生成,上游按次计费——允许后台按模型单独定价
	// (config.uploadCost);未配置时落回下方常规解析(与一次生成同价)。
	if m.Type == "audio" && isUploadTask(in) {
		if v := numField(cfg, "uploadCost"); v > 0 {
			if factor < 1 {
				factor = 1
			}
			return int(math.Ceil(v * factor))
		}
	}

	isVideo := m.Type == "video"
	resolution := strField(in, "resolution")
	clarity := strField(in, "clarity")
	if clarity == "" {
		clarity = resolution
	}
	duration := strField(in, "duration")
	quality := strField(in, "quality")

	base := 0.0

	// 1. price matrix (priceMatrix, aliased to pricing by translateModelConfig).
	matrix := asMatrix(cfg["priceMatrix"])
	if matrix == nil {
		matrix = asMatrix(cfg["pricing"])
	}
	if matrix != nil {
		if isVideo {
			base = matrixLookup(matrix, duration, resolution)
		} else {
			base = matrixLookup(matrix, quality, clarity)
		}
	}

	// 2. video duration@<res> modifier tables.
	if base <= 0 && isVideo && resolution != "" {
		if mods := asMatrix(cfg["priceModifiers"]); mods != nil {
			base = matrixLookup(mods, "duration@"+resolution, duration)
		}
	}

	// 3. model-level flat override, then 4. catalog price.
	if base <= 0 {
		base = numField(cfg, "creditCost")
	}
	if base <= 0 {
		base = float64(m.PointCost)
	}
	if base <= 0 {
		return 0
	}

	// Images honor the batch count; a video generation is a single clip.
	if !isVideo {
		if n := batchCount(in); n > 1 {
			base *= float64(n)
		}
	}

	if factor < 1 {
		factor = 1
	}
	return int(math.Ceil(base * factor))
}

// isUploadTask reports whether the generate input carries Suno 的参考音频登记
// 任务(extras.task == "upload";延长/翻唱本地音频前的独立一步)。
func isUploadTask(in map[string]any) bool {
	ex, _ := in["extras"].(map[string]any)
	if ex == nil {
		return false
	}
	t, _ := ex["task"].(string)
	return strings.EqualFold(strings.TrimSpace(t), "upload")
}

// matrixLookup tries matrix[k1][k2] then matrix[k2][k1] (axis-order agnostic),
// returning the first positive numeric value or 0.
func matrixLookup(matrix map[string]any, k1, k2 string) float64 {
	if k1 == "" || k2 == "" {
		return 0
	}
	if v := matrixCell(matrix, k1, k2); v > 0 {
		return v
	}
	return matrixCell(matrix, k2, k1)
}

func matrixCell(matrix map[string]any, k1, k2 string) float64 {
	row, ok := matrix[k1].(map[string]any)
	if !ok {
		return 0
	}
	return toNum(row[k2])
}

func asMatrix(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func strField(m map[string]any, key string) string {
	if s, ok := m[key].(string); ok {
		return s
	}
	return ""
}

func numField(m map[string]any, key string) float64 {
	if m == nil {
		return 0
	}
	return toNum(m[key])
}

// toNum coerces a JSON number or numeric string to float64 (0 on failure).
func toNum(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0
		}
		return f
	}
	return 0
}
