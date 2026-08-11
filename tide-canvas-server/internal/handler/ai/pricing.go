package ai

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"tidecanvas/internal/model"
)

// pricing.go computes the authoritative point cost of a generation server-side.
// The frontend (points estimate + the model's price matrix) only renders an
// estimate; this is the value the balance is actually charged against.
// Resolution order, per generation:
//
//	1. upscale config pricePerSecond × source duration, rounded up. When the
//	   field is absent, legacy upscale records continue through the rules below.
//	2. price matrix (config priceMatrix, aliased to pricing): spec-indexed unit
//	   price. image = [quality][clarity], video = [duration][resolution]. Looked
//	   up in BOTH axis orders so either admin authoring orientation resolves.
//	3. priceModifiers "duration@<res>"[duration] (video add-on tables).
//	4. config creditCost (model-level flat override).
//	5. model.PointCost (= MarketModel.Price integer part).
//
// The base is then ×batchCount for images, rounding up.
//（团队加价倍率已随团队功能整链下线,2026-08-01:倍率恒为 1,不再参与。）

// resolveCost returns the points to charge for one generation of model m given
// the raw generate input.
func resolveCost(m *model.AiModel, rawInput json.RawMessage) int {
	if cost, configured, valid := resolveUpscaleTimeCost(m, rawInput); configured {
		if !valid {
			return 0
		}
		return cost
	}

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
			return int(math.Ceil(v))
		}
	}

	isVideo := m.Type == "video"
	resolution := strField(in, "resolution")
	if m.Type == "upscale" {
		// 超分档位只认 targetResolution(与 provider upscaleParams 同口径):
		// 共用输入形态里残留的通用 resolution(如视频节点的 480p)既不发上游
		// 也不参与计费,否则计费档与实际提交档可能背离。
		resolution = inputStr(in, "targetResolution", "target_resolution")
	}
	clarity := strField(in, "clarity")
	if clarity == "" {
		clarity = resolution
	}
	// duration 客户端可能发数字（画布视频节点发秒数 number）也可能发 "4s" 字符串，
	// 全部收敛成字符串参与查表。
	duration := strField(in, "duration")
	if duration == "" {
		if f := numField(in, "duration"); f > 0 {
			duration = strconv.FormatFloat(f, 'f', -1, 64)
		}
	}
	quality := strField(in, "quality")

	base := 0.0

	// 1. price matrix (priceMatrix, aliased to pricing by translateModelConfig).
	// 容错查表：后台矩阵键可能是 "4s"/"720p"，客户端参数可能是 "4"/"720P"——
	// 时长带不带 s、大小写、行列轴序全部兼容，避免 miss 后静默落到模型固定价。
	matrix := asMatrix(cfg["priceMatrix"])
	if matrix == nil {
		matrix = asMatrix(cfg["pricing"])
	}
	if matrix != nil {
		if isVideo {
			base = matrixLookupFuzzy(matrix, durationKeyVariants(duration), keyVariants(resolution))
		} else {
			qKeys := keyVariants(quality)
			if len(qKeys) == 0 {
				// 图片模型未配置画质档位（生成请求不带 quality）：后台矩阵以
				// 「default」单行存清晰度定价（画质留空的兼容形态）；画质有值时
				// 行为与原先完全一致。
				qKeys = []string{"default"}
			}
			base = matrixLookupFuzzy(matrix, qKeys, keyVariants(clarity))
		}
	}

	// 2. video duration@<res> modifier tables.
	if base <= 0 && isVideo && resolution != "" {
		if mods := asMatrix(cfg["priceModifiers"]); mods != nil {
			for _, r := range keyVariants(resolution) {
				if base = matrixLookupFuzzy(mods, []string{"duration@" + r}, durationKeyVariants(duration)); base > 0 {
					break
				}
			}
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

	// Images honor the batch count; a video generation is a single clip, and an
	// upscale always produces exactly one output(共用输入形态里残留的 batchCount
	// 不得放大计费).
	if !isVideo && m.Type != "upscale" {
		if n := batchCount(in); n > 1 {
			base *= float64(n)
		}
	}

	return int(math.Ceil(base))
}

// resolveUpscaleTimeCost resolves the new per-second pricing contract. The
// booleans distinguish an unconfigured legacy model from a configured model
// whose request is missing a usable source-video duration.
func resolveUpscaleTimeCost(m *model.AiModel, rawInput json.RawMessage) (cost int, configured bool, valid bool) {
	if m == nil || m.Type != "upscale" || strings.TrimSpace(m.Config) == "" {
		return 0, false, false
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(m.Config), &cfg); err != nil {
		return 0, false, false
	}
	rate := numField(cfg, "pricePerSecond")
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return 0, false, false
	}

	in := map[string]any{}
	if len(rawInput) > 0 {
		_ = json.Unmarshal(rawInput, &in)
	}
	duration := durationSeconds(in["duration"])
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return 0, true, false
	}
	return int(math.Ceil(rate * duration)), true, true
}

func durationSeconds(v any) float64 {
	if s, ok := v.(string); ok {
		s = strings.TrimSpace(s)
		s = strings.TrimSuffix(strings.ToLower(s), "s")
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return 0
		}
		return f
	}
	return toNum(v)
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

// keyVariants lists lookup candidates for one axis key: raw / lower / upper.
func keyVariants(k string) []string {
	k = strings.TrimSpace(k)
	if k == "" {
		return nil
	}
	out := []string{k}
	for _, v := range []string{strings.ToLower(k), strings.ToUpper(k)} {
		if v != k {
			out = append(out, v)
		}
	}
	return out
}

// durationKeyVariants additionally tries the "s" suffix both ways（后台存 "4s"，
// 客户端常发 "4"/4）。
func durationKeyVariants(k string) []string {
	out := keyVariants(k)
	if len(out) == 0 {
		return nil
	}
	base := strings.TrimSpace(k)
	if strings.HasSuffix(base, "s") {
		out = append(out, keyVariants(strings.TrimSuffix(base, "s"))...)
	} else {
		out = append(out, keyVariants(base+"s")...)
	}
	return out
}

// matrixLookupFuzzy tries every candidate pair (both axis orders via matrixLookup),
// returning the first positive value.
func matrixLookupFuzzy(matrix map[string]any, k1s, k2s []string) float64 {
	for _, a := range k1s {
		for _, b := range k2s {
			if v := matrixLookup(matrix, a, b); v > 0 {
				return v
			}
		}
	}
	return 0
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
