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

func TestGroupbuyPackQuotesUseOwnedSlotsAndPreserveThirtySeconds(t *testing.T) {
	s, _, provider := templateFixture(t)
	ctx := context.Background()
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	var rows []model.StudioTemplate
	if err := s.repo.db.Where("source_key LIKE ?", studiotemplate.GroupbuyPromoSourcePrefix+"%").Order("sort_order").Find(&rows).Error; err != nil || len(rows) != 50 {
		t.Fatal("new pack not loaded", err)
	}
	if _, err := CheckStudioTemplate(ctx, s.repo.db, rows[0]); err == nil {
		t.Fatal("unsupported duration silently shortened")
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Update("config",
		`{"modes":["omni_ref"],"durations":["30s"],"ratios":["9:16"],"resolutions":["1080p"],"maxPromptChars":6000,"refLimits":{"omniRef.imageCount":5},"videoBillingMode":"per_request","pricePerRequestByResolution":{"1080p":19}}`).Error; err != nil {
		t.Fatal(err)
	}
	for _, file := range []model.File{
		{ID: 201, OwnerID: 42, FileType: "image", FileUrl: "https://fixture.test/product.png"},
		{ID: 202, OwnerID: 42, FileType: "image", FileUrl: "https://fixture.test/rules.png"},
	} {
		if err := s.repo.db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range rows {
		t.Run(row.Title, func(t *testing.T) {
			setup, err := CheckStudioTemplate(ctx, s.repo.db, row)
			if err != nil || setup.Options.Duration != 30 || setup.Options.AspectRatio != "9:16" || setup.BasePointCost != 19 {
				t.Fatalf("invalid preflight: %+v %v", setup, err)
			}
			row.Status = 1
			row.ModelKey = setup.ModelID
			row.Options = setup.Options
			if err := s.repo.db.Save(&row).Error; err != nil {
				t.Fatal(err)
			}
			for _, input := range []string{
				`{"imageIds":["91"],"imageSlots":[2]}`,
				`{"imageIds":["91","201","202"],"imageSlots":[2,4,5]}`,
			} {
				q := quoteTemplate(t, s, row.ID, input)
				if q.PointCost != 19 || q.Options.Duration != 30 || q.ModelID != "fixture-video" {
					t.Fatal("quote changed model, duration or price", q)
				}
				dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(input)}
				if err := s.prepareTemplateGeneration(ctx, 42, &dto); err != nil {
					t.Fatal(err)
				}
				prompt := inputStr(decodeInput(dto.Input), "prompt")
				if strings.Contains(prompt, "{{image:") || !strings.Contains(prompt, row.InputLabels.Images[0]+"：未上传") || !strings.Contains(prompt, row.InputLabels.Images[1]+"：@图1") {
					t.Fatal("optional portrait/required scene misbound")
				}
				if strings.Contains(input, "201") && (!strings.Contains(prompt, row.InputLabels.Images[3]+"：@图2") || !strings.Contains(prompt, row.InputLabels.Images[4]+"：@图3")) {
					t.Fatal("product/evidence image misbound")
				}
				if strings.Contains(string(dto.PublicInput), "prompt") || strings.Contains(string(dto.PublicInput), "完整30秒时间轴") {
					t.Fatal("private prompt disclosed")
				}
			}
			bad := generateDTO{TemplateID: row.ID, Input: json.RawMessage(`{"imageIds":["201"],"imageSlots":[4]}`)}
			if err := s.prepareTemplateGeneration(ctx, 42, &bad); err == nil {
				t.Fatal("required scene not enforced")
			}
		})
	}
	var owner model.User
	if err := s.repo.db.First(&owner, 42).Error; err != nil || owner.Points != 100 || len(provider.seen) != 0 {
		t.Fatal("preflight or quote charged the user", err)
	}
	input := `{"imageIds":["91","201","202"],"imageSlots":[2,4,5]}`
	q := quoteTemplate(t, s, rows[0].ID, input)
	register := false
	dto := generateDTO{TemplateID: rows[0].ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(input), RegisterWork: &register, ClientRequestID: "groupbuy-pack-run"}
	task, err := s.generate(ctx, 42, dto)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case sent := <-provider.seen:
		if sent.Handler != "reference_to_video" || durationSeconds(sent.Input["duration"]) != 30 || inputStr(sent.Input, "aspectRatio") != "9:16" {
			t.Fatal("provider settings changed")
		}
		if !reflect.DeepEqual(inputImageURLs(sent.Input), []string{"https://fixture.test/input.png", "https://fixture.test/product.png", "https://fixture.test/rules.png"}) {
			t.Fatal("provider reference order changed")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("generation not dispatched")
	}
	var completed model.AiTask
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if err := s.repo.db.First(&completed, "id = ?", task.ID).Error; err != nil {
			t.Fatal(err)
		}
		if completed.Status != statusProcessing {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if completed.Status != statusSuccess || strings.Contains(completed.Input+completed.ResultMeta, "完整30秒时间轴") {
		t.Fatal("generation failed or recipe leaked")
	}
	replay, err := s.generate(ctx, 42, dto)
	if err != nil || replay.ID != task.ID {
		t.Fatal("duplicate submit did not recover the existing task", err)
	}
	if err := s.repo.db.First(&owner, 42).Error; err != nil || owner.Points != 81 {
		t.Fatal("generation not charged exactly once at configured price", owner.Points, err)
	}
}
