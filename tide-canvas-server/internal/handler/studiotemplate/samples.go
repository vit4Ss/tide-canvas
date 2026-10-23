package studiotemplate

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
)

//go:embed samples.json
var sampleCatalog []byte

const SampleSourcePrefix = "builtin:studio-samples-v1:"

// Only migrate exact bundled instructions which referred to the retired prompt
// editor. Operator-written hints and deleted records must remain untouched.
var legacySampleInputHints = map[string]string{
	"clay-adventure":  "上传 1 张人物、宠物或物品图片，再补充它要经历的场景。",
	"paper-mountains": "上传主体图片，描述你想变成纸艺的场景或空间。",
	"rainy-cinema":    "上传 1 张清晰人物照片，可补充服装、城市或人物情绪。",
	"celestial-koi":   "上传人物、物品或场景图片，补充希望出现的东方意象。",
	"canyon-chase":    "上传 1 张包含主体与环境的图片，补充行进方向和镜头运动。",
}

// SeedSamples installs original, generated starter assets with their matching
// creative recipes. A tombstone is intentional: operator edits, downlisting and
// deletion must survive every later restart. Video starter templates remain
// drafts until an operator verifies their configuration and publishes them.
func SeedSamples(db *gorm.DB) error {
	var entries []struct {
		Slug     string  `json:"slug"`
		Template SaveDTO `json:"template"`
	}
	if err := json.Unmarshal(sampleCatalog, &entries); err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Slug == "" {
			return fmt.Errorf("studio sample slug is missing")
		}
		if err := entry.Template.Validate(); err != nil {
			return fmt.Errorf("studio sample %s: %w", entry.Slug, err)
		}
		key := SampleSourcePrefix + entry.Slug
		var existing model.StudioTemplate
		err := db.Unscoped().Select("id", "input_labels").Where("source_key = ?", key).Take(&existing).Error
		if err == nil {
			if len(existing.InputLabels.Images)+len(existing.InputLabels.Videos)+len(existing.InputLabels.Audio) == 0 {
				raw, _ := json.Marshal(entry.Template.InputLabels)
				if err := db.Model(&model.StudioTemplate{}).Where("id = ? AND (input_labels IS NULL OR input_labels IN ?)", existing.ID, []string{"", "null"}).UpdateColumn("input_labels", string(raw)).Error; err != nil {
					return err
				}
			}
			if legacy, ok := legacySampleInputHints[entry.Slug]; ok {
				if err := db.Model(&model.StudioTemplate{}).Where("id = ? AND input_hint = ?", existing.ID, legacy).
					UpdateColumn("input_hint", entry.Template.InputHint).Error; err != nil {
					return err
				}
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		row := entry.Template.Row()
		row.SourceKey = &key
		if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}
