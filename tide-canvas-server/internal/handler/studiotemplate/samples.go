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

// SeedSamples installs original, generated starter assets with their matching
// creative recipes. A tombstone is intentional: operator edits, downlisting and
// deletion must survive every later restart. Video keyframes remain drafts
// until an operator supplies an actual playable preview.
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
		err := db.Unscoped().Select("id").Where("source_key = ?", key).Take(&existing).Error
		if err == nil {
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
