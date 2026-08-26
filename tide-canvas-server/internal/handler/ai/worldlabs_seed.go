package ai

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// SeedWorldLabsModels exposes the two predictable-cost Marble tiers when the
// deployment has a World Labs API key. Existing rows are never overwritten, so
// administrators retain full control over pricing, ordering and visibility.
func SeedWorldLabsModels(db *gorm.DB, cfg config.WorldLabsConfig) error {
	if db == nil || strings.TrimSpace(cfg.APIKey) == "" {
		return nil
	}
	type seed struct {
		key         string
		name        string
		description string
		credits     int64
		estSeconds  int
	}
	seeds := []seed{
		{
			key: "marble-1.0-draft", name: "World Labs Marble 1.0 Draft",
			description: "快速生成可漫游的 3D Gaussian Splat 场景，包含 SPZ、碰撞 GLB、全景图和缩略图。",
			credits:     250, estSeconds: 180,
		},
		{
			key: "marble-1.1", name: "World Labs Marble 1.1",
			description: "高质量可漫游 3D 世界，包含 SPZ 视觉场景、碰撞 GLB、全景图和缩略图。",
			credits:     1600, estSeconds: 300,
		},
	}
	now := time.Now()
	for index, item := range seeds {
		var count int64
		if err := db.Model(&model.MarketModel{}).Where("model_key = ?", item.key).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		modelConfig, err := json.Marshal(map[string]any{
			"provider":             worldLabsProviderName,
			"threeDKind":           "world",
			"supportedHandlers":    []string{"generate_3d"},
			"modes":                []string{"t2_3d", "i2_3d", "mv2_3d"},
			"capabilities":         []string{"text", "image", "multi-image", "spz", "collider-glb", "panorama"},
			"max3DMultiViewImages": 8,
			"max3DImageSizeMB":     20,
			"supplierCredits":      item.credits,
			"estSeconds":           item.estSeconds,
		})
		if err != nil {
			return err
		}
		row := model.MarketModel{
			AuthorID:    0,
			Name:        item.name,
			Description: item.description,
			Tags:        "World Labs,Marble,3D 场景,Gaussian Splat",
			ModelKey:    item.key,
			Config:      string(modelConfig),
			Type:        "3d",
			Price:       decimal.NewFromInt(item.credits),
			SortOrder:   900 + index,
			Status:      1,
		}
		row.ID = idgen.Next()
		row.CreateTime = now
		row.UpdateTime = now
		if err := db.Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}
