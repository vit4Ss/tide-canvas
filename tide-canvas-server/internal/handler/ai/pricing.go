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
//	1. upscale config pricePerSecondByResolution[targetResolution] × the
//	   server-confirmed source duration, rounded up. The legacy uniform
//	   pricePerSecond field is accepted only as a rolling-upgrade fallback.
//	2. video per-request config pricePerRequestByResolution[resolution] when
//	   videoBillingMode == "per_request". Duration is deliberately ignored.
//	3. price matrix (config priceMatrix, aliased to pricing): spec-indexed unit
//	   price. image = [quality][clarity], video = [duration][resolution]. Looked
//	   up in BOTH axis orders so either admin authoring orientation resolves.
//	4. priceModifiers "duration@<res>"[duration] (video add-on tables).
//	5. config creditCost (model-level flat override).
//	6. model.PointCost (= MarketModel.Price integer part).
//
// The base is then ×batchCount for images, rounding up.
// Optional reference-video billing is intentionally separate: generate() first
// verifies owned media duration in reference_video_pricing.go, then adds that
// server-confirmed surcharge to this base before charging and persisting cost.
//（团队加价倍率已随团队功能整链下线,2026-08-01:倍率恒为 1,不再参与。）

// resolveCost returns the points to charge for one generation of model m given
// the raw generate input.
func resolveCost(m *model.AiModel, rawInput json.RawMessage) int {
	if m != nil && m.Type == "upscale" {
		cost, configured, valid := resolveUpscaleTimeCost(m, rawInput)
		// Video upscale no longer has a flat-price fallback. A submit path must
		// reject an unpriced resolution or unverified duration before charging;
		// returning zero here keeps this pure helper safe for callers/tests.
		if !configured || !valid {
			return 0
		}
		return cost
	}
	if cost, configured, valid := resolveVideoPerRequestCost(m, rawInput); configured {
		// A request in per-request mode is never allowed to fall through to the
		// duration matrix or flat price. The submit path rejects invalid specs;
		// returning zero here keeps this pure helper fail-closed for other callers.
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
	if len(matrix) == 0 {
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

// resolveVideoPerRequestCost resolves the selected resolution's price for one
// video generation. It intentionally never reads duration: 4s and 20s cost the
// same when the model is configured for per-request billing.
func resolveVideoPerRequestCost(m *model.AiModel, rawInput json.RawMessage) (cost int, configured bool, valid bool) {
	_, cost, configured, valid = resolveVideoPerRequestSpec(m, rawInput)
	return cost, configured, valid
}

// resolveVideoPerRequestSpec returns the canonical configured resolution as
// well as its single-request price. Callers that dispatch a generation must
// write this resolution back to input so billing, the task receipt and the
// provider request cannot disagree when a legacy clarity alias (or the sole
// configured-resolution fallback) was used.
func resolveVideoPerRequestSpec(m *model.AiModel, rawInput json.RawMessage) (resolution string, cost int, configured bool, valid bool) {
	if m == nil || m.Type != "video" || strings.TrimSpace(m.Config) == "" {
		return "", 0, false, false
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(m.Config), &cfg); err != nil {
		return "", 0, false, false
	}
	if !strings.EqualFold(strings.TrimSpace(strField(cfg, "videoBillingMode")), "per_request") {
		return "", 0, false, false
	}

	in := map[string]any{}
	if len(rawInput) > 0 {
		if err := json.Unmarshal(rawInput, &in); err != nil {
			return "", 0, true, false
		}
	}
	requested := strings.TrimSpace(inputStr(in, "resolution", "clarity"))
	configuredResolutions, _ := cfg["resolutions"].([]any)
	canonical := ""
	for _, rawResolution := range configuredResolutions {
		candidate, _ := rawResolution.(string)
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if requested == "" {
			if canonical != "" {
				// Multiple supported resolutions require an explicit user choice.
				return "", 0, true, false
			}
			canonical = candidate
			continue
		}
		if strings.EqualFold(candidate, requested) {
			canonical = candidate
			break
		}
	}
	if canonical == "" {
		return "", 0, true, false
	}

	rates, ok := cfg["pricePerRequestByResolution"].(map[string]any)
	if !ok || len(rates) == 0 {
		return "", 0, true, false
	}
	matched := false
	rate := 0.0
	for key, rawRate := range rates {
		if !strings.EqualFold(strings.TrimSpace(key), canonical) {
			continue
		}
		// Case-variant duplicate keys would make a Go-map lookup order-dependent.
		if matched {
			return "", 0, true, false
		}
		matched = true
		rate = toNum(rawRate)
	}
	maxRate := float64((1 << 53) - 1)
	if platformMax := float64(maxPointCost()); platformMax < maxRate {
		maxRate = platformMax
	}
	if !matched || rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || rate > maxRate {
		return "", 0, true, false
	}
	return canonical, int(math.Ceil(rate)), true, true
}

// prepareVideoPerRequestPricingInput makes resolution the canonical wire field
// before the price is charged and the task input is persisted. Duration and all
// unrelated input fields remain untouched.
func prepareVideoPerRequestPricingInput(dto *generateDTO, m *model.AiModel) (configured bool, valid bool) {
	canonical, _, configured, valid := resolveVideoPerRequestSpec(m, dto.Input)
	if !configured || !valid {
		return configured, valid
	}

	in := map[string]any{}
	if len(dto.Input) > 0 {
		// resolveVideoPerRequestSpec already proved this is a JSON object.
		if err := json.Unmarshal(dto.Input, &in); err != nil {
			return true, false
		}
	}
	if in == nil {
		in = map[string]any{}
	}
	in["resolution"] = canonical
	normalized, err := json.Marshal(in)
	if err != nil {
		return true, false
	}
	dto.Input = normalized
	return true, true
}

// resolveUpscaleTimeCost resolves the per-resolution/per-second pricing
// contract. The booleans distinguish an unpriced target resolution from a
// priced request whose duration has not been confirmed yet.
func resolveUpscaleTimeCost(m *model.AiModel, rawInput json.RawMessage) (cost int, configured bool, valid bool) {
	if m == nil || m.Type != "upscale" || strings.TrimSpace(m.Config) == "" {
		return 0, false, false
	}

	in := map[string]any{}
	if len(rawInput) > 0 {
		_ = json.Unmarshal(rawInput, &in)
	}
	resolution := inputStr(in, "targetResolution", "target_resolution")
	rate := resolveUpscalePointRate(m, resolution)
	if rate <= 0 {
		return 0, false, false
	}
	duration := durationSeconds(in["duration"])
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return 0, true, false
	}
	return int(math.Ceil(rate * duration)), true, true
}

// resolveUpscalePointRate returns the configured points/second for one target
// resolution. New records use pricePerSecondByResolution; pricePerSecond keeps
// already-published models billable while admins migrate them in a rolling
// deployment. Resolution lookup is case-insensitive.
func resolveUpscalePointRate(m *model.AiModel, resolution string) float64 {
	if m == nil || m.Type != "upscale" || strings.TrimSpace(m.Config) == "" {
		return 0
	}
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	if resolution == "" {
		return 0
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(m.Config), &cfg); err != nil {
		return 0
	}
	if rates, ok := cfg["pricePerSecondByResolution"].(map[string]any); ok && len(rates) > 0 {
		if resolution != "" {
			for key, value := range rates {
				if strings.EqualFold(strings.TrimSpace(key), resolution) {
					rate := toNum(value)
					if rate > 0 && !math.IsNaN(rate) && !math.IsInf(rate, 0) {
						return rate
					}
				}
			}
		}
		// Once a resolution table exists, an absent/zero cell is deliberately
		// unpriced and must not inherit the old uniform rate.
		return 0
	}
	legacy := numField(cfg, "pricePerSecond")
	if legacy > 0 && !math.IsNaN(legacy) && !math.IsInf(legacy, 0) {
		return legacy
	}
	return 0
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
