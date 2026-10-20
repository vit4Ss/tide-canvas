package studiotemplate

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
	"tidecanvas/internal/model"
)

func TestSampleSeedPreservesCurationAndKeepsStoryboardsDraft(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.StudioTemplate{}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := SeedSamples(db); err != nil {
			t.Fatal(err)
		}
	}
	var rows []model.StudioTemplate
	if err := db.Order("sort_order").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 8 {
		t.Fatalf("seed duplicated or lost samples: %d", len(rows))
	}
	for _, row := range rows {
		if !SafeMediaURL(row.CoverURL) || row.Uses != 0 || row.Prompt == "" {
			t.Fatalf("invalid generated sample: %+v", row)
		}
		if row.MediaType == "video" && (row.Status != 0 || row.PreviewURL != "") {
			t.Fatal("storyboard falsely published as playable video")
		}
		if row.MediaType == "image" && row.Status != 1 {
			t.Fatal("image sample is not available")
		}
	}
	if err := db.Model(&rows[0]).Updates(map[string]any{"title": "operator edited", "status": 0, "uses": 7}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&rows[1]).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	var edited model.StudioTemplate
	if err := db.First(&edited, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if edited.Title != "operator edited" || edited.Status != 0 || edited.Uses != 7 {
		t.Fatal("restart overwrote operator curation")
	}
	var count int64
	if err := db.Model(&model.StudioTemplate{}).Where("source_key = ?", rows[1].SourceKey).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("deleted sample was resurrected")
	}
	legacy := legacySampleInputHints["clay-adventure"]
	db.Model(&rows[0]).UpdateColumn("input_hint", legacy)
	db.Model(&rows[2]).UpdateColumn("input_hint", "operator-authored upload instructions")
	if err := SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	db.First(&edited, "id = ?", rows[0].ID)
	if edited.InputHint == legacy || edited.Title != "operator edited" {
		t.Fatal("bundled hint migration failed or overwrote operator title")
	}
	var custom model.StudioTemplate
	db.First(&custom, "id = ?", rows[2].ID)
	if custom.InputHint != "operator-authored upload instructions" {
		t.Fatal("operator instructions overwritten")
	}
	db.Model(&rows[0]).UpdateColumn("input_labels", nil)
	db.Model(&rows[2]).UpdateColumn("input_labels", `{"images":["运营自定义人像"]}`)
	if err := SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	db.First(&edited, "id = ?", rows[0].ID)
	db.First(&custom, "id = ?", rows[2].ID)
	if len(edited.InputLabels.Images) == 0 || custom.InputLabels.Images[0] != "运营自定义人像" {
		t.Fatal("label upgrade lost operator curation")
	}
	db.Model(&rows[0]).UpdateColumn("input_labels", "{}")
	if err := SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	var cleared model.StudioTemplate
	db.First(&cleared, "id = ?", rows[0].ID)
	if len(cleared.InputLabels.Images) != 0 {
		t.Fatal("restart restored intentionally cleared labels")
	}
}

func TestBundledMediaPathsCannotEscapeSampleDirectory(t *testing.T) {
	if !SafeMediaURL("/studio-samples/v1/clay-adventure.webp") {
		t.Fatal("bundled artwork cannot be saved by admin")
	}
	for _, s := range []string{"/studio-samples/v1/../../api/file.webp", "/studio-samples/v1/%2e%2e/a.webp", "/studio-samples/v1/a.webp?redirect=1", "/studio-samples/v1/a.webp#x", "/studio-samples/v1/a.html"} {
		if SafeMediaURL(s) {
			t.Fatalf("invalid bundled path accepted: %s", s)
		}
	}
}
