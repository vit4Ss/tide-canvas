package market

// studio.go adds the public GET /api/market/studio-models endpoint consumed by
// the 创作台 (create studio). It returns the listed models of a given media type
// together with each model's raw `config` object (modes / ratios / resolutions /
// qualities / defaultPrompt / ideas / icon / provider …). The studio renders its
// controls dynamically from this config: an option the admin did not configure
// is simply absent, so the studio hides it.

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// StudioModelVO is the studio-facing shape of a market model.
type StudioModelVO struct {
	ID        idgen.ID        `json:"id"`
	Name      string          `json:"name"`
	ModelKey  string          `json:"modelKey"`
	Type      string          `json:"type"`
	Desc      string          `json:"desc"`
	PointCost string          `json:"pointCost"`
	Config    json.RawMessage `json:"config"` // per-model settings object (or null)
}

// studioModels handles GET /api/market/studio-models?type=image (public).
func (h *handler) studioModels(c *gin.Context) {
	typ := strings.TrimSpace(c.Query("type"))
	vos, err := h.svc.studioModels(typ)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list studio models")
		return
	}
	response.OK(c, vos)
}

// studioModels (service) returns listed models of a type with their config,
// grouped by the admin-configured media-type order（类型间顺序）; rows inside a
// type already arrive by sort_order（类型内顺序，后台上移/下移）.
func (s *service) studioModels(typ string) ([]StudioModelVO, error) {
	rows, err := s.repo.studioModels(typ)
	if err != nil {
		return nil, err
	}
	rank := map[string]int{}
	for i, t := range s.repo.typeOrder() {
		rank[t] = i
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ri, ok := rank[rows[i].Type]
		if !ok {
			ri = len(rank)
		}
		rj, ok := rank[rows[j].Type]
		if !ok {
			rj = len(rank)
		}
		return ri < rj
	})
	vos := make([]StudioModelVO, 0, len(rows))
	for i := range rows {
		m := &rows[i]
		vos = append(vos, StudioModelVO{
			ID:        m.ID,
			Name:      m.Name,
			ModelKey:  m.ModelKey,
			Type:      m.Type,
			Desc:      m.Description,
			PointCost: m.Price.String(),
			Config:    normalizedStudioConfig(m.Config),
		})
	}
	return vos, nil
}

// normalizedStudioConfig returns the market config dialect every studio client
// expects. It aliases legacy pricing → priceMatrix without mutating the database,
// and sorts duration options numerically. This keeps old deployments readable
// during rolling upgrades while the authoritative stored payload remains intact.
func normalizedStudioConfig(raw string) json.RawMessage {
	c := strings.TrimSpace(raw)
	if c == "" || !json.Valid([]byte(c)) {
		return nil
	}

	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(c), &obj); err != nil || obj == nil {
		return json.RawMessage(c)
	}
	changed := false
	if _, exists := obj["priceMatrix"]; !exists {
		if legacy, ok := obj["pricing"]; ok {
			obj["priceMatrix"] = legacy
			changed = true
		}
	}
	encodedDurations, ok := obj["durations"]
	if ok {
		var durations []json.RawMessage
		if err := json.Unmarshal(encodedDurations, &durations); err == nil && len(durations) >= 2 {
			seconds := make([]float64, len(durations))
			valid := true
			for i := range durations {
				value, parsed := studioDurationSeconds(durations[i])
				if !parsed {
					valid = false
					break
				}
				seconds[i] = value
			}
			if valid {
				type durationEntry struct {
					raw     json.RawMessage
					seconds float64
				}
				entries := make([]durationEntry, len(durations))
				for i := range durations {
					entries[i] = durationEntry{raw: durations[i], seconds: seconds[i]}
				}
				sort.SliceStable(entries, func(i, j int) bool { return entries[i].seconds < entries[j].seconds })
				for i := range entries {
					durations[i] = entries[i].raw
				}
				if sortedDurations, err := json.Marshal(durations); err == nil {
					obj["durations"] = sortedDurations
					changed = true
				}
			}
		}
	}
	if !changed {
		return json.RawMessage(c)
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return json.RawMessage(c)
	}
	return out
}

func studioDurationSeconds(raw json.RawMessage) (float64, bool) {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		text = strings.TrimSpace(strings.TrimSuffix(strings.ToLower(text), "s"))
		seconds, err := strconv.ParseFloat(text, 64)
		return seconds, err == nil && seconds > 0
	}
	var seconds float64
	if err := json.Unmarshal(raw, &seconds); err != nil || seconds <= 0 {
		return 0, false
	}
	return seconds, true
}

// studioModels (repo) returns listed models of a type (all types when empty),
// by the admin-managed sort_order（同值回退最热优先）.
func (r *repo) studioModels(typ string) ([]model.MarketModel, error) {
	tx := r.db.Model(&model.MarketModel{}).Where("status = ?", statusListed)
	if typ != "" {
		tx = tx.Where("type = ?", typ)
	}
	var rows []model.MarketModel
	if err := tx.Order("sort_order ASC, use_count DESC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// typeOrder returns the admin-configured media-type order (sys_config
// market.typeOrder), falling back to the factory default（文本→音频→图片→视频→3D）.
func (r *repo) typeOrder() []string {
	var row model.SysConfig
	if err := r.db.Select("config_value").
		Where("config_key = ?", model.ConfigKeyMarketTypeOrder).
		First(&row).Error; err == nil {
		if parsed := model.ParseMarketTypeOrder(row.ConfigValue); parsed != nil {
			return parsed
		}
	}
	return model.DefaultMarketTypeOrder
}
