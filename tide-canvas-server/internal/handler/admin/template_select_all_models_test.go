package admin

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/model"
)

func TestSelectAllTemplateModelsOnlyPersistsRuntimeCompatibleChoices(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.StudioTemplate{}, &model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.MarketModel{
		{ModelKey: "image-default", Name: "Default image", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["1:1"]}`},
		{ModelKey: "image-compatible", Name: "Compatible image", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["1:1"]}`},
		{ModelKey: "image-wide-only", Name: "Wide image", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["16:9"]}`},
		{ModelKey: "video-model", Name: "Video", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["5s"]}`},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows := []model.StudioTemplate{
		{Kind: "style", MediaType: "image", Title: "Needs update", Prompt: "recipe", Mode: "i2i", ModelKey: "image-default", Requirements: model.StudioTemplateRequirements{Images: 1}, Options: model.StudioTemplateOptions{AspectRatio: "1:1"}},
		{Kind: "style", MediaType: "image", Title: "Already open", Prompt: "recipe", Mode: "i2i", ModelKey: "image-default", SelectableModelKeys: []string{"image-compatible"}, Requirements: model.StudioTemplateRequirements{Images: 1}, Options: model.StudioTemplateOptions{AspectRatio: "1:1"}},
		{Kind: "style", MediaType: "image", Title: "Incomplete", Prompt: "", Mode: "i2i", ModelKey: "image-default", Requirements: model.StudioTemplateRequirements{Images: 1}},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 9; i++ {
		row := model.StudioTemplate{Kind: "style", MediaType: "image", Title: fmt.Sprintf("Incomplete %d", i+1), Prompt: "", Mode: "i2i", ModelKey: "image-default", Requirements: model.StudioTemplateRequirements{Images: 1}}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	r := gin.New()
	admin := r.Group("/admin")
	RegisterStudioTemplates(admin, &app.Deps{DB: db})
	call := func(body string) struct {
		Success bool                          `json:"success"`
		Data    selectAllTemplateModelsResult `json:"data"`
	} {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/admin/studio-templates/select-all-models", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		var responseBody struct {
			Success bool                          `json:"success"`
			Data    selectAllTemplateModelsResult `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &responseBody); err != nil {
			t.Fatal(err)
		}
		if !responseBody.Success {
			t.Fatalf("batch failed: %s", w.Body.String())
		}
		return responseBody
	}
	first := call(`{}`)
	if first.Data.Total != 12 || first.Data.Done || first.Data.NextAfterID == 0 || first.Data.ThroughID == 0 || first.Data.Updated != 1 || first.Data.Unchanged != 1 || first.Data.Skipped != 8 || first.Data.Failed != 0 {
		t.Fatalf("unexpected first chunk: %+v", first.Data)
	}
	second := call(fmt.Sprintf(`{"afterId":"%s","throughId":"%s"}`, first.Data.NextAfterID, first.Data.ThroughID))
	if second.Data.Total != 12 || !second.Data.Done || second.Data.Updated != 0 || second.Data.Unchanged != 0 || second.Data.Skipped != 2 || second.Data.Failed != 0 {
		t.Fatalf("unexpected second chunk: %+v", second.Data)
	}
	var updated model.StudioTemplate
	if err := db.First(&updated, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(updated.SelectableModelKeys) != 1 || updated.SelectableModelKeys[0] != "image-compatible" {
		t.Fatalf("unexpected selectable models: %#v", updated.SelectableModelKeys)
	}
	if updated.ModelKey != rows[0].ModelKey || updated.Status != rows[0].Status || updated.Options != rows[0].Options || updated.Prompt != rows[0].Prompt {
		t.Fatal("bulk selection changed the default model, status or recipe")
	}
	if retry := call(`{}`).Data; retry.Updated != 0 || retry.Unchanged != 2 {
		t.Fatalf("repeated operation was not idempotent: %+v", retry)
	}

	shared := []model.MarketModel{
		{ModelKey: "shared", Name: "Shared compatible", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["1:1"]}`},
		{ModelKey: "shared", Name: "Shared incompatible", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["16:9"]}`},
		{ModelKey: "paused", Name: "Paused", Type: "image", Status: 1, Config: `{"modes":["i2i"],"availabilityStatus":"maintenance"}`},
	}
	for i := range shared {
		if err := db.Create(&shared[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 22; i++ {
		m := model.MarketModel{ModelKey: fmt.Sprintf("compatible-%d", i), Name: "Compatible", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["1:1"]}`}
		if err := db.Create(&m).Error; err != nil {
			t.Fatal(err)
		}
	}
	call(`{}`)
	if err := db.First(&updated, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(updated.SelectableModelKeys) != 24 {
		t.Fatalf("not all compatible models were selected: %v", updated.SelectableModelKeys)
	}
	got := map[string]bool{}
	for _, key := range updated.SelectableModelKeys {
		got[key] = true
	}
	if !got[shared[0].ID.String()] || got[shared[1].ID.String()] || got["paused"] {
		t.Fatalf("incorrect shared-row or availability filtering: %v", updated.SelectableModelKeys)
	}
	dto := studiotemplate.SaveDTO{Title: "Editable after select all", MediaType: "image", Mode: "i2i", SelectableModelKeys: updated.SelectableModelKeys, Requirements: updated.Requirements}
	if err := dto.Validate(); err != nil {
		t.Fatalf("bulk-created selection cannot be saved in the editor: %v", err)
	}

	videoModels := []model.MarketModel{
		{ModelKey: "long-default", Name: "Long default", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`},
		{ModelKey: "long-compatible", Name: "Long compatible", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`},
	}
	for i := range videoModels {
		if err := db.Create(&videoModels[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	var videoRows []model.StudioTemplate
	for i := 0; i < 13; i++ {
		row := model.StudioTemplate{Kind: "inspiration", MediaType: "video", Title: "Video", Prompt: "recipe", Mode: "i2v", ModelKey: "long-default", Status: i % 2, Requirements: model.StudioTemplateRequirements{Images: 1}, Options: model.StudioTemplateOptions{Duration: 30, AspectRatio: "9:16"}}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		videoRows = append(videoRows, row)
	}
	snapshot := call(`{}`).Data
	if snapshot.Done || snapshot.Total != 25 {
		t.Fatalf("wrong snapshot pagination: %+v", snapshot)
	}
	newRow := videoRows[0]
	newRow.ID = 0
	newRow.Title = "Created after snapshot"
	if err := db.Create(&newRow).Error; err != nil {
		t.Fatal(err)
	}
	processed := len(snapshot.Items)
	for !snapshot.Done {
		snapshot = call(fmt.Sprintf(`{"afterId":%q,"throughId":%q}`, snapshot.NextAfterID.String(), snapshot.ThroughID.String())).Data
		processed += len(snapshot.Items)
	}
	if processed != 25 {
		t.Fatalf("not all snapshot templates processed: %d", processed)
	}
	for _, before := range videoRows {
		var after model.StudioTemplate
		if err := db.First(&after, "id = ?", before.ID).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(after.SelectableModelKeys, []string{"long-compatible"}) || after.Status != before.Status || after.ModelKey != before.ModelKey || after.Options != before.Options {
			t.Fatalf("video selection changed unrelated fields: %+v", after)
		}
	}
	var untouched model.StudioTemplate
	db.First(&untouched, "id = ?", newRow.ID)
	if len(untouched.SelectableModelKeys) != 0 {
		t.Fatal("snapshot included a subsequently created template")
	}
}
