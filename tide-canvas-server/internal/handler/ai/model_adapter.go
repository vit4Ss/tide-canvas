package ai

import (
	"encoding/json"
	"math"
	"strings"

	"tidecanvas/internal/model"
)

// model_adapter.go bridges market_model (the catalog source of truth) to the
// AiModel shape the AI domain's VO and provider already speak.

// marketToAiModel adapts a market_model row to an AiModel. ModelID carries the
// upstream model_key the provider needs; Config is translated so the canvas
// nodes (which read an older field dialect) and the studio (which reads the
// market dialect) both render correctly from the same row.
func marketToAiModel(mm *model.MarketModel) model.AiModel {
	cfg, icon := translateModelConfig(mm.Config)
	return model.AiModel{
		ID:                mm.ID,
		Name:              mm.Name,
		Icon:              icon,
		ModelID:           mm.ModelKey,
		Type:              mm.Type,
		SupportedHandlers: marketSupportedHandlers(mm.Type, mm.Config),
		Config:            cfg,
		PointCost:         mm.Price.IntPart(),
		Enabled:           mm.Status == marketModelListed,
		CreateTime:        mm.CreateTime,
		UpdateTime:        mm.UpdateTime,
	}
}

// marketSupportedHandlers translates relay catalog modes into the generation
// handler names understood by the API and canvas. The relay route selector is
// mode-sensitive: a model id may be routable for reference-video generation
// while having no text-to-video candidate. Returning an empty string retains
// the legacy unrestricted behaviour when the catalog supplies no recognised
// routing metadata.
func marketSupportedHandlers(modelType, raw string) string {
	var cfg map[string]any
	if json.Unmarshal([]byte(raw), &cfg) != nil || cfg == nil {
		return ""
	}

	if explicit := configStrings(cfg["supportedHandlers"]); len(explicit) > 0 {
		return handlerJSON(cleanStrings(explicit))
	}
	if !strings.EqualFold(strings.TrimSpace(modelType), "video") {
		return ""
	}

	// paramsSchema is refreshed on every relay sync, whereas the top-level modes
	// field is editable catalog presentation data. Prefer the live relay schema.
	var modes []string
	if params, ok := cfg["paramsSchema"].(map[string]any); ok {
		modes = configStrings(params["modes"])
	}
	if len(modes) == 0 {
		modes = configStrings(cfg["modes"])
	}
	if handlers := videoHandlersFromMetadata(modes); len(handlers) > 0 {
		return handlerJSON(handlers)
	}
	if handlers := videoHandlersFromMetadata(configStrings(cfg["capabilities"])); len(handlers) > 0 {
		return handlerJSON(handlers)
	}
	return handlerJSON(videoHandlersFromMetadata(configStrings(cfg["operations"])))
}

func configStrings(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if values, ok := value.([]string); ok {
			return cleanStrings(values)
		}
		if value, ok := value.(string); ok {
			return cleanStrings(strings.Split(value, ","))
		}
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if value, ok := item.(string); ok {
			out = append(out, value)
		}
	}
	return cleanStrings(out)
}

func videoHandlersFromMetadata(values []string) []string {
	seen := map[string]bool{}
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		normalized = strings.NewReplacer("-", "_", " ", "_", "/", "_").Replace(normalized)
		handler := ""
		switch normalized {
		case "t2v", "text2video", "text_video", "text_to_video":
			handler = "text_to_video"
		case "i2v", "image2video", "image_video", "image_to_video", "first_frame":
			handler = "image_to_video"
		case "keyframe", "key_frame", "first_last", "first_last_frame", "start_end", "start_end_to_video":
			handler = "start_end_to_video"
		case "omni_ref", "omni_reference", "multi_ref", "multi_reference", "reference_image", "reference_to_video", "subject_reference":
			handler = "reference_to_video"
		default:
			switch {
			case strings.Contains(normalized, "reference") || strings.Contains(normalized, "multi_ref") || strings.Contains(normalized, "omni_ref"):
				handler = "reference_to_video"
			case strings.Contains(normalized, "keyframe") || (strings.Contains(normalized, "first") && strings.Contains(normalized, "last")):
				handler = "start_end_to_video"
			case strings.Contains(normalized, "text") && strings.Contains(normalized, "video"):
				handler = "text_to_video"
			case strings.Contains(normalized, "image") && strings.Contains(normalized, "video"):
				handler = "image_to_video"
			}
		}
		if handler != "" {
			seen[handler] = true
		}
	}

	ordered := []string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"}
	out := make([]string, 0, len(seen))
	for _, handler := range ordered {
		if seen[handler] {
			out = append(out, handler)
		}
	}
	return out
}

func handlerJSON(handlers []string) string {
	if len(handlers) == 0 {
		return ""
	}
	b, err := json.Marshal(handlers)
	if err != nil {
		return ""
	}
	return string(b)
}

func modelSupportsHandler(m *model.AiModel, handler string) bool {
	if m == nil {
		return false
	}
	handlers := parseHandlers(m.SupportedHandlers)
	if len(handlers) == 0 {
		return true
	}
	for _, supported := range handlers {
		if supported == handler {
			return true
		}
	}
	return false
}

func modelVideoDurationAllowed(m *model.AiModel, handler string, input json.RawMessage) (requested float64, configured, allowed bool) {
	switch handler {
	case "text_to_video", "image_to_video", "start_end_to_video", "reference_to_video":
	default:
		return 0, false, true
	}
	if m == nil || strings.TrimSpace(m.Config) == "" {
		return 0, false, true
	}

	requested = durationSeconds(decodeInput(input)["duration"])
	if requested <= 0 {
		return requested, false, true
	}
	var cfg map[string]any
	if json.Unmarshal([]byte(m.Config), &cfg) != nil || cfg == nil {
		return requested, false, true
	}

	// Generation uses only the admin-maintained catalog field. Relay
	// paramsSchema.duration is an import seed for a brand-new model (see
	// buildStudioConfig); after creation, the admin's explicit selection is the
	// sole source of truth and later relay syncs must not override it.
	rawDurations := configDurationValues(cfg["durations"])
	if len(rawDurations) == 0 {
		return requested, false, true
	}

	validCandidates := 0
	for _, raw := range rawDurations {
		candidate := durationSeconds(raw)
		if candidate <= 0 {
			continue
		}
		validCandidates++
		if math.Abs(candidate-requested) < 0.001 {
			return requested, true, true
		}
	}
	if validCandidates == 0 {
		return requested, false, true
	}
	return requested, true, false
}

// configDurationValues preserves numeric entries from older/admin-authored
// configs. configStrings intentionally drops non-strings because it is also
// used for handler metadata, but durationSeconds accepts both JSON numbers and
// strings such as "8s".
func configDurationValues(value any) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	stringsOnly := configStrings(value)
	if len(stringsOnly) == 0 {
		return nil
	}
	values := make([]any, len(stringsOnly))
	for i, item := range stringsOnly {
		values[i] = item
	}
	return values
}

// translateModelConfig returns (config, icon). The market config object uses the
// keys resolutions / batchOptions / priceMatrix; the canvas image/video nodes
// read clarities / batchSizes / pricing. We add the canvas aliases alongside the
// originals (never overwriting an explicitly-set value) so a single stored
// config serves both readers. The model icon, stored inside config, is lifted
// out to AiModel.Icon. On any parse failure the original string is returned
// unchanged.
func translateModelConfig(raw string) (config string, icon string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return raw, ""
	}

	if s, ok := m["icon"].(string); ok {
		icon = strings.TrimSpace(s)
	}

	alias := func(canvasKey, marketKey string) {
		if _, exists := m[canvasKey]; exists {
			return
		}
		if v, ok := m[marketKey]; ok {
			m[canvasKey] = v
		}
	}
	alias("clarities", "resolutions")
	alias("batchSizes", "batchOptions")
	alias("pricing", "priceMatrix")

	b, err := json.Marshal(m)
	if err != nil {
		return raw, icon
	}
	return string(b), icon
}
