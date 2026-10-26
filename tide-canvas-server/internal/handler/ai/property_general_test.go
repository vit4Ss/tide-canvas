package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/model"
)

func TestPropertyPackUsesSeedance720pOwnedReferencesAndQuotedPrice(t *testing.T) {
	s, _, provider := templateFixture(t)
	ctx := context.Background()
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	var rows []model.StudioTemplate
	if err := s.repo.db.Where("source_key LIKE ?", studiotemplate.PropertyGeneralSourcePrefix+"%").Order("sort_order").Find(&rows).Error; err != nil || len(rows) != 30 {
		t.Fatal("property pack missing", err)
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Updates(map[string]any{
		"name":   "Seedance 2.5",
		"config": `{"modes":["omni_ref"],"durations":["15s","30s"],"ratios":["9:16"],"resolutions":["480p","720p","1080p"],"refLimits":{"omniRef.imageCount":5},"maxPromptChars":6000,"videoBillingMode":"per_request","pricePerRequestByResolution":{"480p":3,"720p":7,"1080p":19}}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	for _, file := range []model.File{
		{ID: 201, OwnerID: 42, FileType: "image", FileUrl: "https://fixture.test/uniform.png"},
		{ID: 202, OwnerID: 42, FileType: "image", FileUrl: "https://fixture.test/service-info.png"},
		{ID: 203, OwnerID: 99, FileType: "image", FileUrl: "https://fixture.test/other-user.png"},
	} {
		if err := s.repo.db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := range rows {
		row := &rows[i]
		setup, err := CheckStudioTemplate(ctx, s.repo.db, *row)
		if err != nil || setup.ModelID != "fixture-video" || setup.ModelName != "Seedance 2.5" || setup.Options.Resolution != "720p" || setup.Options.Duration != 30 || setup.Options.AspectRatio != "9:16" || setup.BasePointCost != 7 {
			t.Fatal("wrong property setup", row.Title, setup, err)
		}
		row.ModelKey, row.Options, row.Status = setup.ModelID, setup.Options, 1
		if err := s.repo.db.Save(row).Error; err != nil {
			t.Fatal(err)
		}
		for _, input := range []string{`{"imageIds":["91"],"imageSlots":[2]}`, `{"imageIds":["91","201","202"],"imageSlots":[2,4,5]}`} {
			q := quoteTemplate(t, s, row.ID, input)
			if q.PointCost != 7 || q.Options.Resolution != "720p" || q.Options.Duration != 30 {
				t.Fatal("quote used different output/price", q)
			}
			dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(input)}
			if err := s.prepareTemplateGeneration(ctx, 42, &dto); err != nil {
				t.Fatal(err)
			}
			prompt := inputStr(decodeInput(dto.Input), "prompt")
			if strings.Contains(prompt, "{{image:") || !strings.Contains(prompt, row.InputLabels.Images[0]+"：未上传") || !strings.Contains(prompt, row.InputLabels.Images[1]+"：@图1") {
				t.Fatal("optional portrait shifted scene reference", row.Title)
			}
			if strings.Contains(input, "201") && (!strings.Contains(prompt, row.InputLabels.Images[3]+"：@图2") || !strings.Contains(prompt, row.InputLabels.Images[4]+"：@图3")) {
				t.Fatal("uniform/service reference shifted", row.Title)
			}
			if strings.Contains(string(dto.PublicInput), "prompt") || strings.Contains(string(dto.PublicInput), "【完整时间轴】") {
				t.Fatal("private recipe leaked")
			}
		}
		for _, input := range []string{`{"imageIds":["201"],"imageSlots":[4]}`, `{"imageIds":["203"],"imageSlots":[2]}`} {
			dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(input)}
			if err := s.prepareTemplateGeneration(ctx, 42, &dto); err == nil {
				t.Fatal("missing scene or foreign upload accepted")
			}
		}
	}
	var owner model.User
	s.repo.db.First(&owner, 42)
	if owner.Points != 100 || len(provider.seen) != 0 {
		t.Fatal("setup or quote generated/charged")
	}
	q := quoteTemplate(t, s, rows[0].ID, `{"imageIds":["91","201","202"],"imageSlots":[2,4,5]}`)
	register := false
	task, err := s.generate(ctx, 42, generateDTO{TemplateID: rows[0].ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler,
		Input: json.RawMessage(`{"imageIds":["91","201","202"],"imageSlots":[2,4,5]}`), RegisterWork: &register, ClientRequestID: "property-pack-run"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case sent := <-provider.seen:
		if sent.Handler != "reference_to_video" || inputStr(sent.Input, "resolution") != "720p" || inputStr(sent.Input, "aspectRatio") != "9:16" || durationSeconds(sent.Input["duration"]) != 30 {
			t.Fatal("provider input disagrees with template", sent.Input)
		}
		if !reflect.DeepEqual(inputImageURLs(sent.Input), []string{"https://fixture.test/input.png", "https://fixture.test/uniform.png", "https://fixture.test/service-info.png"}) {
			t.Fatal("provider received wrong references")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("generation not dispatched")
	}
	waitCoverTask(t, &GenerationFacade{svc: s}, task.ID, TaskSuccess)
	s.repo.db.First(&owner, 42)
	var completed model.AiTask
	s.repo.db.First(&completed, "id = ?", task.ID)
	if owner.Points != 93 || completed.PointCost != 7 || strings.Contains(completed.Input, "【完整时间轴】") {
		t.Fatal("billing/public history mismatch", owner.Points, completed.PointCost)
	}
}
