package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
)

func TestTemplatePromptSelectsSeedance25AndPreservesExplicitChoices(t *testing.T) {
	s, row, _ := templateFixture(t)
	ctx := context.Background()
	cfg := `{"modes":["i2v"],"ratios":["16:9","9:16"],"durations":["15s","30s"]}`
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Updates(map[string]any{"config": cfg, "use_count": 9999}).Error; err != nil {
		t.Fatal(err)
	}
	preferred := model.MarketModel{Name: "Seedance 2.5", ModelKey: "doubao-seedance-2-5-test", Type: "video", Status: 1, Config: cfg, Price: decimal.NewFromInt(23)}
	if err := s.repo.db.Create(&preferred).Error; err != nil {
		t.Fatal(err)
	}
	row.MediaType, row.Mode, row.ModelKey, row.Prompt = "video", "i2v", "", "【生成视频：30秒｜9:16】\n拍摄门店"
	row.Options = model.StudioTemplateOptions{}
	if err := s.repo.db.Save(row).Error; err != nil {
		t.Fatal(err)
	}
	setup, err := CheckStudioTemplate(ctx, s.repo.db, *row)
	if err != nil || setup.ModelID != preferred.ModelKey || setup.Options.Duration != 30 || setup.Options.AspectRatio != "9:16" || setup.BasePointCost != 23 {
		t.Fatal("header/default selection mismatch", setup, err)
	}
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	dto := generateDTO{TemplateID: row.ID, ModelID: q.ModelID, Input: json.RawMessage(`{"imageIds":["91"]}`)}
	if err := s.prepareTemplateGeneration(ctx, 42, &dto); err != nil {
		t.Fatal(err)
	}
	input := decodeInput(dto.Input)
	if q.ModelID != preferred.ModelKey || q.PointCost != 23 || durationSeconds(input["duration"]) != 30 || inputStr(input, "aspectRatio") != "9:16" {
		t.Fatal("quote and provider input disagree", q, input)
	}
	if err := s.repo.db.Model(&preferred).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := CheckStudioTemplate(ctx, s.repo.db, *row); err == nil || !strings.Contains(err.Error(), "Seedance 2.5") {
		t.Fatal("missing preferred model silently fell back", err)
	}
	row.ModelKey = "fixture-video"
	row.Options = model.StudioTemplateOptions{Duration: 15, AspectRatio: "16:9"}
	setup, err = CheckStudioTemplate(ctx, s.repo.db, *row)
	if err != nil || setup.ModelID != "fixture-video" || setup.Options.Duration != 15 || setup.Options.AspectRatio != "16:9" {
		t.Fatal("manual choice changed", setup, err)
	}
}

func TestTemplateDuplicateModelKeysKeepSelectedCatalogPrice(t *testing.T) {
	s, row, provider := templateFixture(t)
	ctx := context.Background()
	cfg := `{"modes":["i2v"],"ratios":["9:16"],"durations":["30s"]}`
	first := model.MarketModel{Name: "Seedance 2.5 other catalog row", ModelKey: "seedance-2.5-shared", Type: "video", Status: 1, Config: cfg, Price: decimal.NewFromInt(5)}
	selected := model.MarketModel{Name: "Seedance 2.5 selected catalog row", ModelKey: first.ModelKey, Type: "video", Status: 1, Config: cfg, Price: decimal.NewFromInt(23), UseCount: 100}
	if err := s.repo.db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	row.MediaType, row.Mode, row.ModelKey, row.Prompt = "video", "i2v", "", "【生成视频：30秒｜9:16】\n门店宣传"
	row.Options = model.StudioTemplateOptions{}
	setup, err := CheckStudioTemplate(ctx, s.repo.db, *row)
	if err != nil || setup.ModelID != selected.ID.String() || setup.ModelName != selected.Name || setup.BasePointCost != 23 {
		t.Fatal("selection was resolved again to another catalog row", setup, err)
	}
	row.ModelKey, row.Options = setup.ModelID, setup.Options
	if err := s.repo.db.Save(row).Error; err != nil {
		t.Fatal(err)
	}
	// Later catalog ordering must not change the pinned model or its debit.
	if err := s.repo.db.Model(&first).Update("use_count", 999).Error; err != nil {
		t.Fatal(err)
	}
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	if q.ModelID != selected.ID.String() || q.PointCost != 23 {
		t.Fatal("quote changed pinned row", q)
	}
	register := false
	vo, err := s.generate(ctx, 42, generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`), RegisterWork: &register})
	if err != nil {
		t.Fatal(err)
	}
	waitCoverTask(t, &GenerationFacade{svc: s}, vo.ID, TaskSuccess)
	var task model.AiTask
	s.repo.db.First(&task, "id = ?", vo.ID)
	var owner model.User
	s.repo.db.First(&owner, "id = ?", 42)
	if task.ModelID != selected.ID || task.PointCost != 23 || owner.Points != 77 || len(provider.seen) != 1 {
		t.Fatal("actual execution did not use the quoted catalog row", task.ModelID, task.PointCost, owner.Points)
	}
	if err := s.repo.db.Model(&selected).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := CheckStudioTemplate(ctx, s.repo.db, *row); err == nil {
		t.Fatal("disabled pinned row fell back to a duplicate key")
	}
}
