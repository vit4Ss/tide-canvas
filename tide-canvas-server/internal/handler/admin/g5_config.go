package admin

import (
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g5_config.go: admin system configuration (model.SysConfig). GET returns the
// full list of config entries; PUT upserts one or more keys by configKey.

// ConfigVO is one system configuration entry.
type ConfigVO struct {
	ID          idgen.ID `json:"id"`
	ConfigKey   string   `json:"configKey"`
	ConfigValue string   `json:"configValue"`
	Group       string   `json:"group"`
	Description string   `json:"description"`
}

func toConfigVO(m *model.SysConfig) ConfigVO {
	return ConfigVO{
		ID:          m.ID,
		ConfigKey:   m.ConfigKey,
		ConfigValue: m.ConfigValue,
		Group:       m.Group,
		Description: m.Description,
	}
}

// ConfigItemDTO is a single config key to upsert.
type ConfigItemDTO struct {
	ConfigKey   string `json:"configKey" binding:"required,max=128"`
	ConfigValue string `json:"configValue"`
	Group       string `json:"group"`
	Description string `json:"description"`
}

// ConfigUpsertDTO accepts either {items:[...]} or a bare array body. The handler
// also accepts a plain map<string,string> shape for convenience.
type ConfigUpsertDTO struct {
	Items []ConfigItemDTO `json:"items"`
}

// RegisterConfig mounts the config admin routes on the admin group.
//
//	GET /config  -> []ConfigVO
//	PUT /config  {items:[ConfigItemDTO]} | [ConfigItemDTO] | map<string,string> -> []ConfigVO
func RegisterConfig(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	g.GET("/config", func(c *gin.Context) {
		var rows []model.SysConfig
		if err := db.Order("config_group ASC, config_key ASC").Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to load config")
			return
		}
		vos := make([]ConfigVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toConfigVO(&rows[i]))
		}
		response.OK(c, vos)
	})

	g.PUT("/config", func(c *gin.Context) {
		items, err := bindConfigItems(c)
		if err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		if len(items) == 0 {
			response.Fail(c, response.CodeBadRequest, "no config items provided")
			return
		}

		// Upsert each by configKey; conflict updates value/group/description.
		txErr := db.Transaction(func(tx *gorm.DB) error {
			for i := range items {
				it := items[i]
				key := strings.TrimSpace(it.ConfigKey)
				if key == "" {
					continue
				}
				row := model.SysConfig{
					ConfigKey:   key,
					ConfigValue: it.ConfigValue,
					Group:       it.Group,
					Description: it.Description,
				}
				if err := tx.Clauses(clause.OnConflict{
					Columns:   []clause.Column{{Name: "config_key"}},
					DoUpdates: clause.AssignmentColumns([]string{"config_value", "config_group", "description", "update_time"}),
				}).Create(&row).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if txErr != nil {
			response.Fail(c, response.CodeServerError, "failed to save config")
			return
		}

		var rows []model.SysConfig
		if err := db.Order("config_group ASC, config_key ASC").Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to reload config")
			return
		}
		vos := make([]ConfigVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toConfigVO(&rows[i]))
		}
		response.OK(c, vos)
	})
}

// bindConfigItems accepts three request shapes: {items:[...]}, a bare [...] array
// of ConfigItemDTO, or a flat map<string,string> of key->value. The map form is
// convenient for the settings screen which serializes a plain object.
func bindConfigItems(c *gin.Context) ([]ConfigItemDTO, error) {
	raw, err := c.GetRawData()
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, nil
	}

	// Wrapped object {items:[...]} first.
	if strings.HasPrefix(trimmed, "{") {
		var wrapped ConfigUpsertDTO
		if err := jsonUnmarshal(raw, &wrapped); err == nil && len(wrapped.Items) > 0 {
			return wrapped.Items, nil
		}
		// Fall back to flat map<string,string>.
		var m map[string]string
		if err := jsonUnmarshal(raw, &m); err != nil {
			return nil, err
		}
		items := make([]ConfigItemDTO, 0, len(m))
		for k, v := range m {
			items = append(items, ConfigItemDTO{ConfigKey: k, ConfigValue: v})
		}
		return items, nil
	}

	// Bare array form.
	var arr []ConfigItemDTO
	if err := jsonUnmarshal(raw, &arr); err != nil {
		return nil, err
	}
	return arr, nil
}
