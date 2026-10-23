package studiotemplate

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
)

// Source prompts are embedded in the backend only, never served as public files.
//
//go:embed content-packs/store-food-v002/catalog.json content-packs/store-food-v002/source/*.txt
var contentPackFiles embed.FS

const StoreFoodSourcePrefix = "content:store-food-v002:"
const storeFoodRoot = "content-packs/store-food-v002/"

type contentPackEntry struct {
	Slug         string  `json:"slug"`
	SourceFile   string  `json:"sourceFile"`
	SourceSHA256 string  `json:"sourceSha256"`
	Template     SaveDTO `json:"template"`
}

func storeFoodEntries() ([]contentPackEntry, error) {
	raw, err := contentPackFiles.ReadFile(storeFoodRoot + "catalog.json")
	if err != nil {
		return nil, err
	}
	var pack struct {
		Entries []contentPackEntry `json:"entries"`
	}
	if err := json.Unmarshal(raw, &pack); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	if len(pack.Entries) != 20 {
		return nil, fmt.Errorf("store/food pack must contain 20 recipes")
	}
	for i := range pack.Entries {
		entry := &pack.Entries[i]
		if entry.Slug == "" || seen[entry.Slug] {
			return nil, fmt.Errorf("duplicate or missing content slug")
		}
		seen[entry.Slug] = true
		if err := entry.Template.Validate(); err != nil {
			return nil, fmt.Errorf("content %s: %w", entry.Slug, err)
		}
		if entry.Template.Status != 0 || entry.Template.MediaType != "video" {
			return nil, fmt.Errorf("content %s must start as a video draft", entry.Slug)
		}
		source, err := contentPackFiles.ReadFile(storeFoodRoot + entry.SourceFile)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(source)
		if hex.EncodeToString(sum[:]) != entry.SourceSHA256 {
			return nil, fmt.Errorf("content source checksum mismatch: %s", entry.Slug)
		}
	}
	return pack.Entries, nil
}

// SeedContentPacks adds the supplied content once. Unscoped lookup honors deleted
// records; subsequent startup never rewrites an operator's recipe or publication.
func SeedContentPacks(db *gorm.DB) error {
	entries, err := storeFoodEntries()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, entry := range entries {
			key := StoreFoodSourcePrefix + entry.Slug
			var count int64
			if err := tx.Unscoped().Model(&model.StudioTemplate{}).Where("source_key = ?", key).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			row := entry.Template.Row()
			row.SourceKey = &key
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
