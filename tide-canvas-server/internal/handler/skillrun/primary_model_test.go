package skillrun

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func primaryModelTestService(t *testing.T) *service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	rows := []model.MarketModel{
		{Name: "Earlier text", ModelKey: "earlier-text", Type: "text", Status: 1, SortOrder: 0, Config: `{"fileUpload":true}`},
		{Name: "Primary text", ModelKey: "primary-text", Type: "text", Status: 1, SortOrder: 99, Config: `{"aiOptimizePrimary": true, "fileUpload": true}`},
		{Name: "Offline primary", ModelKey: "offline-primary", Type: "text", Status: 0, SortOrder: -2, Config: `{"aiOptimizePrimary":true}`},
		{Name: "Blank primary", Type: "text", Status: 1, SortOrder: -1, Config: `{"aiOptimizePrimary":true}`},
		{Name: "Image", ModelKey: "image-model", Type: "image", Status: 1, Config: `{}`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	// GORM applies the schema's default status=1 when a struct has zero status.
	if err := db.Model(&model.MarketModel{}).Where("model_key = ?", "offline-primary").Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	return &service{db: db}
}

func TestSkillDefaultModelsFollowTextPrimary(t *testing.T) {
	s := primaryModelTestService(t)
	for _, output := range []string{"text", "file"} {
		got, err := s.resolveModel("", "", output)
		if err != nil || got != "primary-text" {
			t.Errorf("default %s model = %q, %v; want primary-text", output, got, err)
		}
	}
	for _, handler := range []string{"analyze_image", "analyze_video", "analyze_audio", "analyze_webpage", "analyze_account"} {
		got, err := s.resolveAnalysisModel(handler, "", "")
		if err != nil || got != "primary-text" {
			t.Errorf("default %s model = %q, %v; want primary-text", handler, got, err)
		}
	}
	got, err := s.resolveTextModelForAssets("", "", []AssetInput{{Type: "image", URL: "https://example.test/frame.jpg"}})
	if err != nil || got != "primary-text" {
		t.Errorf("text with attachments = %q, %v; want primary-text", got, err)
	}
	got, err = s.resolveModel("", "", "image")
	if err != nil || got != "image-model" {
		t.Errorf("image model = %q, %v; want image-model", got, err)
	}
	// A newly selected primary takes effect without regenerating the Manifest.
	if err := s.db.Model(&model.MarketModel{}).Where("model_key = ?", "primary-text").Update("config", `{"aiOptimizePrimary":false,"fileUpload":true}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&model.MarketModel{}).Where("model_key = ?", "earlier-text").Update("config", `{"aiOptimizePrimary":true,"fileUpload":true}`).Error; err != nil {
		t.Fatal(err)
	}
	for _, handler := range []string{"analyze_video", "analyze_webpage"} {
		got, err := s.resolveAnalysisModel(handler, "", "")
		if err != nil || got != "earlier-text" {
			t.Errorf("changed primary for %s = %q, %v", handler, got, err)
		}
	}
}

func TestSkillPrimaryKeepsExplicitSelectionsAndLegacyDefaults(t *testing.T) {
	s := primaryModelTestService(t)
	for _, selection := range [][2]string{{"earlier-text", "primary-text"}, {"", "earlier-text"}} {
		got, err := s.resolveModel(selection[0], selection[1], "text")
		if err != nil || got != "earlier-text" {
			t.Errorf("explicit text = %q, %v; want earlier-text", got, err)
		}
		got, err = s.resolveAnalysisModel("analyze_video", selection[0], selection[1])
		if err != nil || got != "earlier-text" {
			t.Errorf("explicit analysis = %q, %v; want earlier-text", got, err)
		}
	}
	if _, err := s.resolveModel("missing-model", "", "text"); err == nil {
		t.Fatal("missing explicit model silently fell back to primary")
	}
	for _, output := range []string{"text", "file"} {
		if got, err := s.resolveModel("", "missing-model", output); err == nil || got != "" {
			t.Errorf("unavailable requested %s model fell back to %q: %v", output, got, err)
		}
	}
	for _, config := range []string{`{}`, `{"aiOptimizePrimary":"true"}`, `invalid JSON`} {
		if err := s.db.Model(&model.MarketModel{}).Where("model_key = ?", "primary-text").Update("config", config).Error; err != nil {
			t.Fatal(err)
		}
		got, err := s.resolveModel("", "", "text")
		if err != nil || got != "earlier-text" {
			t.Errorf("without primary (%s) = %q, %v; want earlier-text", config, got, err)
		}
	}
}

func TestSkillAnalysisDoesNotSilentlyReplaceIncompatiblePrimary(t *testing.T) {
	s := primaryModelTestService(t)
	if err := s.db.Model(&model.MarketModel{}).Where("model_key = ?", "primary-text").Update("config", `{"aiOptimizePrimary":true,"fileUpload":false}`).Error; err != nil {
		t.Fatal(err)
	}
	for _, handler := range []string{"analyze_image", "analyze_video", "analyze_audio"} {
		got, err := s.resolveAnalysisModel(handler, "", "")
		if err == nil || got != "" || !strings.Contains(err.Error(), "主模型") {
			t.Errorf("incompatible primary for %s = %q, %v; want actionable error", handler, got, err)
		}
	}
}
