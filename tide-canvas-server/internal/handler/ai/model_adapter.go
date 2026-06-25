package ai

import (
	"encoding/json"
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
		ID:         mm.ID,
		Name:       mm.Name,
		Icon:       icon,
		ModelID:    mm.ModelKey,
		Type:       mm.Type,
		Config:     cfg,
		PointCost:  mm.Price.IntPart(),
		Enabled:    mm.Status == marketModelListed,
		CreateTime: mm.CreateTime,
		UpdateTime: mm.UpdateTime,
	}
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
