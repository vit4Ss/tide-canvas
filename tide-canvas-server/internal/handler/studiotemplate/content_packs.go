package studiotemplate

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
)

// Source prompts are embedded in the backend only, never served as public files.
//
//go:embed content-packs/store-food-v002/catalog.json content-packs/store-food-v002/source/*.txt
//go:embed content-packs/groupbuy-promo-v2/catalog.json content-packs/groupbuy-promo-v2/source/*.txt content-packs/groupbuy-promo-v2/source/manifest.json
var contentPackFiles embed.FS

const StoreFoodSourcePrefix = "content:store-food-v002:"
const storeFoodRoot = "content-packs/store-food-v002/"
const GroupbuyPromoSourcePrefix = "content:groupbuy-promo-v2:"
const groupbuyPromoRoot = "content-packs/groupbuy-promo-v2/"

type contentPackEntry struct {
	Slug         string  `json:"slug"`
	SourceFile   string  `json:"sourceFile"`
	SourceSHA256 string  `json:"sourceSha256"`
	Template     SaveDTO `json:"template"`
}

func storeFoodEntries() ([]contentPackEntry, error) {
	return readContentPack(storeFoodRoot, 20)
}

func groupbuyPromoEntries() ([]contentPackEntry, error) {
	return readContentPack(groupbuyPromoRoot, 50)
}

func readContentPack(root string, expected int) ([]contentPackEntry, error) {
	raw, err := contentPackFiles.ReadFile(root + "catalog.json")
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
	if len(pack.Entries) != expected {
		return nil, fmt.Errorf("content pack %s must contain %d recipes", root, expected)
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
		if !fs.ValidPath(entry.SourceFile) || !strings.HasPrefix(entry.SourceFile, "source/") {
			return nil, fmt.Errorf("invalid content source path: %s", entry.Slug)
		}
		source, err := contentPackFiles.ReadFile(root + entry.SourceFile)
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
	var rows []model.StudioTemplate
	for _, pack := range []struct {
		prefix string
		load   func() ([]contentPackEntry, error)
	}{
		{StoreFoodSourcePrefix, storeFoodEntries},
		{GroupbuyPromoSourcePrefix, groupbuyPromoEntries},
	} {
		entries, err := pack.load()
		if err != nil {
			return err
		}
		for _, entry := range entries {
			key := pack.prefix + entry.Slug
			row := entry.Template.Row()
			row.SourceKey = &key
			rows = append(rows, row)
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			var count int64
			if err := tx.Unscoped().Model(&model.StudioTemplate{}).Where("source_key = ?", *row.SourceKey).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
