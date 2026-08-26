package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

func TestSeedWorldLabsModelsIsCredentialGatedAndPreservesAdminEdits(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:worldlabs_seed?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	if err := SeedWorldLabsModels(db, config.WorldLabsConfig{}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.MarketModel{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("without credential count=%d err=%v", count, err)
	}
	if err := SeedWorldLabsModels(db, config.WorldLabsConfig{APIKey: "secret"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.MarketModel{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("seeded count=%d err=%v", count, err)
	}
	var seededDraft model.MarketModel
	if err := db.Where("model_key = ?", "marble-1.0-draft").First(&seededDraft).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(seededDraft.Config, `"creditCost"`) {
		t.Fatal("supplier config must not override the admin-editable catalog price")
	}
	if seededDraft.Type != "3d" || seededDraft.Status != 1 || !seededDraft.Price.Equal(decimal.NewFromInt(250)) {
		t.Fatalf("draft is not a visible, correctly-priced 3D catalog row: %#v", seededDraft)
	}
	adapted := marketToAiModel(&seededDraft)
	if adapted.ModelID != "marble-1.0-draft" || adapted.PointCost != 250 || !modelSupportsHandler(&adapted, "generate_3d") {
		t.Fatalf("draft is not usable by the generation pipeline: %#v", adapted)
	}
	var seededConfig map[string]any
	if err := json.Unmarshal([]byte(seededDraft.Config), &seededConfig); err != nil {
		t.Fatal(err)
	}
	if seededConfig["provider"] != worldLabsProviderName || seededConfig["threeDKind"] != "world" {
		t.Fatalf("draft routing config = %#v", seededConfig)
	}
	if err := db.Model(&model.MarketModel{}).Where("model_key = ?", "marble-1.0-draft").
		Updates(map[string]any{"price": decimal.NewFromInt(999), "status": 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedWorldLabsModels(db, config.WorldLabsConfig{APIKey: "secret"}); err != nil {
		t.Fatal(err)
	}
	var draft model.MarketModel
	if err := db.Where("model_key = ?", "marble-1.0-draft").First(&draft).Error; err != nil {
		t.Fatal(err)
	}
	if !draft.Price.Equal(decimal.NewFromInt(999)) || draft.Status != 2 {
		t.Fatalf("admin edit was overwritten: price=%s status=%d", draft.Price, draft.Status)
	}
}
