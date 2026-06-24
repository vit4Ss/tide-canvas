package market

// studio.go adds the public GET /api/market/studio-models endpoint consumed by
// the 创作台 (create studio). It returns the listed models of a given media type
// together with each model's raw `config` object (modes / ratios / resolutions /
// qualities / defaultPrompt / ideas / icon / provider …). The studio renders its
// controls dynamically from this config: an option the admin did not configure
// is simply absent, so the studio hides it.

import (
	"encoding/json"
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

// studioModels (service) returns listed models of a type with their config.
func (s *service) studioModels(typ string) ([]StudioModelVO, error) {
	rows, err := s.repo.studioModels(typ)
	if err != nil {
		return nil, err
	}
	vos := make([]StudioModelVO, 0, len(rows))
	for i := range rows {
		m := &rows[i]
		var cfg json.RawMessage
		if c := strings.TrimSpace(m.Config); c != "" && json.Valid([]byte(c)) {
			cfg = json.RawMessage(c)
		}
		vos = append(vos, StudioModelVO{
			ID:        m.ID,
			Name:      m.Name,
			ModelKey:  m.ModelKey,
			Type:      m.Type,
			Desc:      m.Description,
			PointCost: m.Price.String(),
			Config:    cfg,
		})
	}
	return vos, nil
}

// studioModels (repo) returns listed models of a type (all types when empty),
// most-used first.
func (r *repo) studioModels(typ string) ([]model.MarketModel, error) {
	tx := r.db.Model(&model.MarketModel{}).Where("status = ?", statusListed)
	if typ != "" {
		tx = tx.Where("type = ?", typ)
	}
	var rows []model.MarketModel
	if err := tx.Order("use_count DESC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}
