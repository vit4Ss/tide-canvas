package admin

import (
	"errors"
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

// baselineConfigKeys are the must-exist sys_config keys seeded by
// model.AutoMigrate / boot wiring. They drive live pages (页脚/首页/定价/聊天
// 上下文/积分策略), so the delete endpoint refuses to remove them.
var baselineConfigKeys = map[string]struct{}{
	model.ConfigKeyFooterLinks:           {},
	model.ConfigKeyHomeGlobal:            {},
	model.ConfigKeyRegisterClosed:        {},
	model.ConfigKeyPricingCompare:        {},
	model.ConfigKeyPricingFaq:            {},
	model.ConfigKeyChatContextTokenLimit: {},
	model.ConfigKeyChatCompressAt:        {},
	model.ConfigKeyMarketTypeOrder:       {},
	model.ConfigKeyCanvasNodeFeatures:    {},
	model.ConfigKeyAIUserConcurrentLimit: {},
	"points.checkinDaily":                {},
	"points.checkinMonthlyCap":           {},
	"points.inviteReward":                {},
	"points.signupBonus":                 {},
	"storage.ossAccelerateEnabled":       {},
}

// adminVisibleConfig scopes a sys_config query to the rows the 配置管理 screen
// should show, in its display order. Two kinds of rows are excluded:
//   - 画布节点策略:整块 JSON 由「节点配置」专页维护,不该以裸文本行出现;
//   - internal 分组:一次性迁移标记等内部记账,界面上看不出含义,被误编辑或
//     删除会让迁移重跑(如新菜单键被重新塞回管理员刚取消的角色)。
func adminVisibleConfig(db *gorm.DB) *gorm.DB {
	return db.Where("config_key <> ?", model.ConfigKeyCanvasNodeFeatures).
		Where("COALESCE(config_group, '') <> ?", model.ConfigGroupInternal).
		Order("config_group ASC, config_key ASC")
}

// RegisterConfig mounts the config admin routes on the admin group.
//
//	GET    /config      -> []ConfigVO
//	PUT    /config      {items:[ConfigItemDTO]} | [ConfigItemDTO] | map<string,string> -> []ConfigVO
//	DELETE /config/:id  -> void（基线键拒绝删除）
func RegisterConfig(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	g.GET("/config", func(c *gin.Context) {
		var rows []model.SysConfig
		if err := adminVisibleConfig(db).Find(&rows).Error; err != nil {
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
		items, mapForm, err := bindConfigItems(c)
		if err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		if len(items) == 0 {
			response.Fail(c, response.CodeBadRequest, "no config items provided")
			return
		}
		for i := range items {
			key := strings.TrimSpace(items[i].ConfigKey)
			if key == model.ConfigKeyCanvasNodeFeatures {
				response.Fail(c, response.CodeBadRequest, "canvas node configuration must be edited through /api/admin/canvas/nodes")
				return
			}
			if key == model.ConfigKeyAIUserConcurrentLimit {
				if _, ok := model.ParseAIUserConcurrentLimit(items[i].ConfigValue); !ok {
					response.Fail(c, response.CodeBadRequest, "单用户生成并发上限必须是 1-100 的整数")
					return
				}
			}
			if key == "storage.ossAccelerateEnabled" && items[i].ConfigValue != "0" && items[i].ConfigValue != "1" {
				response.Fail(c, response.CodeBadRequest, "OSS 传输加速开关必须是 0 或 1")
				return
			}
		}

		// The flat-map convenience shape is update-only: any JSON object would
		// otherwise mint arbitrary sys_config rows ({"name":"x"} → key "name").
		// Creating new keys requires the explicit {items:[...]} / array shapes.
		if mapForm {
			keys := make([]string, 0, len(items))
			for i := range items {
				if k := strings.TrimSpace(items[i].ConfigKey); k != "" {
					keys = append(keys, k)
				}
			}
			var existing []string
			if err := db.Model(&model.SysConfig{}).Where("config_key IN ?", keys).
				Pluck("config_key", &existing).Error; err != nil {
				response.Fail(c, response.CodeServerError, "failed to save config")
				return
			}
			known := make(map[string]struct{}, len(existing))
			for _, k := range existing {
				known[k] = struct{}{}
			}
			for _, k := range keys {
				if _, ok := known[k]; !ok {
					response.Fail(c, response.CodeBadRequest, "未知配置键: "+k)
					return
				}
			}
		}

		// Upsert each by configKey; conflict updates value/group/description.
		// map 简写形态只带 key/value——按「只更新值」语义收窄更新列,否则会把
		// 已有行的分组/描述抹成空串(种子行的 group 就曾被这样洗掉过)。
		assign := []string{"config_value", "config_group", "description", "update_time"}
		if mapForm {
			assign = []string{"config_value", "update_time"}
		}
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
					DoUpdates: clause.AssignmentColumns(assign),
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
		if err := adminVisibleConfig(db).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to reload config")
			return
		}
		vos := make([]ConfigVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toConfigVO(&rows[i]))
		}
		response.OK(c, vos)
	})

	// 删除配置键。基线键（页面/策略消费方仍在读）拒绝删除；其余键（含误建的
	// 垃圾键）可删——config 此前无删除通道，误建的行只能进 DB 手清。
	g.DELETE("/config/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		var row model.SysConfig
		if err := db.First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "config not found")
				return
			}
			response.Fail(c, response.CodeServerError, "failed to load config")
			return
		}
		if _, protected := baselineConfigKeys[row.ConfigKey]; protected {
			response.Fail(c, response.CodeBadRequest, "基线配置不可删除: "+row.ConfigKey)
			return
		}
		if err := db.Delete(&model.SysConfig{}, "id = ?", id).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to delete config")
			return
		}
		response.OK[any](c, nil)
	})
}

// bindConfigItems accepts three request shapes: {items:[...]}, a bare [...] array
// of ConfigItemDTO, or a flat map<string,string> of key->value. The map form is
// convenient for the settings screen which serializes a plain object; mapForm
// reports when that shape was used so the caller can apply update-only rules.
func bindConfigItems(c *gin.Context) (items []ConfigItemDTO, mapForm bool, err error) {
	raw, err := c.GetRawData()
	if err != nil {
		return nil, false, err
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, false, nil
	}

	// Wrapped object {items:[...]} first.
	if strings.HasPrefix(trimmed, "{") {
		var wrapped ConfigUpsertDTO
		if err := jsonUnmarshal(raw, &wrapped); err == nil && len(wrapped.Items) > 0 {
			return wrapped.Items, false, nil
		}
		// Fall back to flat map<string,string>.
		var m map[string]string
		if err := jsonUnmarshal(raw, &m); err != nil {
			return nil, false, err
		}
		items = make([]ConfigItemDTO, 0, len(m))
		for k, v := range m {
			items = append(items, ConfigItemDTO{ConfigKey: k, ConfigValue: v})
		}
		return items, true, nil
	}

	// Bare array form.
	var arr []ConfigItemDTO
	if err := jsonUnmarshal(raw, &arr); err != nil {
		return nil, false, err
	}
	return arr, false, nil
}
