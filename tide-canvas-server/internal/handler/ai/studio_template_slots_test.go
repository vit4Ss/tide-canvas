package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestContentPackOptionalImagesKeepIdentityAndDuration(t *testing.T) {
	s, _, provider := templateFixture(t)
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 6; i++ {
		if err := s.repo.db.Create(&model.File{ID: idgen.ID(100 + i), OwnerID: 42, FileType: "image", FileUrl: fmt.Sprintf("https://fixture.test/slot%d.png", i)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Update("config", `{"modes":["omni_ref"],"durations":["15s","30s"],"ratios":["9:16"],"refLimits":{"omniRef.imageCount":6}}`)
	for _, slug := range []string{"hotpot-15s", "chili-factory-30s"} {
		t.Run(slug, func(t *testing.T) {
			var row model.StudioTemplate
			s.repo.db.Where("source_key = ?", studiotemplate.StoreFoodSourcePrefix+slug).First(&row)
			row.Status = 1
			row.ModelKey = "fixture-video"
			s.repo.db.Save(&row)
			input := `{"imageIds":["101","102","104","105"],"imageSlots":[1,2,4,5]}`
			q := quoteTemplate(t, s, row.ID, input)
			if q.Options.Duration != row.Options.Duration {
				t.Fatal("duration changed")
			}
			dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(input)}
			if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err != nil {
				t.Fatal(err)
			}
			in := decodeInput(dto.Input)
			prompt := inputStr(in, "prompt")
			if strings.Contains(prompt, "{{image:") || strings.Contains(prompt, "@图5") || strings.Contains(prompt, "@图6") {
				t.Fatal("unresolved or invalid reference number")
			}
			if !strings.Contains(prompt, "本人头像：未上传") || !strings.Contains(prompt, "未上传头像时，生成一位") {
				t.Fatal("missing portrait was not explicitly absent")
			}
			if !strings.Contains(prompt, row.InputLabels.Images[3]+"：@图3") || !strings.Contains(prompt, row.InputLabels.Images[4]+"：@图4") {
				t.Fatal("product/room references shifted incorrectly")
			}
			if !reflect.DeepEqual(inputImageURLs(in), []string{"https://fixture.test/slot1.png", "https://fixture.test/slot2.png", "https://fixture.test/slot4.png", "https://fixture.test/slot5.png"}) {
				t.Fatal("actual image order changed")
			}
			if strings.Contains(string(dto.PublicInput), "讲解人") || strings.Contains(string(dto.PublicInput), "prompt") {
				t.Fatal("private recipe exposed")
			}
			register := false
			accepted, err := s.generate(context.Background(), 42, generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(input), RegisterWork: &register})
			if err != nil {
				t.Fatal(err)
			}
			select {
			case sent := <-provider.seen:
				if inputStr(sent.Input, "prompt") != prompt || durationSeconds(sent.Input["duration"]) != row.Options.Duration {
					t.Fatal("provider received different recipe or duration")
				}
			case <-time.After(4 * time.Second):
				t.Fatal("provider not called")
			}
			var completed model.AiTask
			deadline := time.Now().Add(4 * time.Second)
			for time.Now().Before(deadline) {
				s.repo.db.First(&completed, "id = ?", accepted.ID)
				if completed.Status != statusProcessing {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if completed.Status != statusSuccess || strings.Contains(completed.Input, "讲解人") || strings.Contains(completed.ResultMeta, "讲解人") {
				t.Fatal("content task failed or exposed recipe")
			}
			for _, bad := range []string{
				`{"imageIds":["101","102","104","105"]}`,
				`{"imageIds":["101","102"],"imageSlots":[1,1]}`,
				`{"imageIds":["101","102"],"imageSlots":[1,7]}`,
				`{"imageIds":["101","102"],"imageSlots":[1]}`,
				`{"imageIds":["102","104"],"imageSlots":[2,4]}`,
				`{"imageIds":["101","92"],"imageSlots":[1,2]}`,
			} {
				d := generateDTO{TemplateID: row.ID, Input: json.RawMessage(bad)}
				if err := s.prepareTemplateGeneration(context.Background(), 42, &d); err == nil {
					t.Fatalf("unsafe slots accepted: %s", bad)
				}
			}
		})
	}
}

func TestOptionalPromptPreflightCoversMissingImageTextAndAutoSkipsShortModels(t *testing.T) {
	s, row, _ := templateFixture(t)
	row.MediaType = "video"
	row.Mode = "ref"
	row.ModelKey = "fixture-video"
	row.Requirements = model.StudioTemplateRequirements{Images: 2, OptionalImages: []int{2}}
	row.InputLabels = model.StudioTemplateInputLabels{Images: []string{"门面", "本人头像"}}
	row.Prompt = strings.Repeat("请参考{{image:2}}。", 40)
	full := model.ResolveTemplateImageReferences(*row, []int{1, 2})
	missing := model.ResolveTemplateImageReferences(*row, []int{1})
	if len([]rune(missing)) <= len([]rune(full)) {
		t.Fatal("fixture does not exercise missing-image expansion")
	}
	limit := utf8.RuneCountInString(full) + 1
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Updates(map[string]any{"use_count": 9999, "config": fmt.Sprintf(`{"modes":["omni_ref"],"maxPromptChars":%d}`, limit)})
	if _, err := CheckStudioTemplate(context.Background(), s.repo.db, *row); err == nil {
		t.Fatal("preflight ignored missing-reference overhead")
	}
	long := model.MarketModel{ModelKey: "long-prompt-video", Name: "Long prompt video", Type: "video", Status: 1, Config: `{"modes":["omni_ref"],"maxPromptChars":0}`}
	if err := s.repo.db.Create(&long).Error; err != nil {
		t.Fatal(err)
	}
	row.ModelKey = ""
	setup, err := CheckStudioTemplate(context.Background(), s.repo.db, *row)
	if err != nil || setup.ModelID != long.ModelKey {
		t.Fatalf("auto failed to skip short model: %+v %v", setup, err)
	}
}

func TestContentPackReferenceBindingReachesRelayHTTPAndStaysPrivate(t *testing.T) {
	s, _, _ := templateFixture(t)
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	var row model.StudioTemplate
	s.repo.db.Where("source_key = ?", studiotemplate.StoreFoodSourcePrefix+"chili-factory-30s").First(&row)
	row.Status = 1
	row.ModelKey = "fixture-video"
	s.repo.db.Save(&row)
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["omni_ref"],"durations":["30s"],"ratios":["9:16"],"refLimits":{"omniRef.imageCount":6}}`)
	for _, i := range []int{1, 2, 4, 5} {
		s.repo.db.Create(&model.File{ID: idgen.ID(200 + i), OwnerID: 42, FileType: "image", FileUrl: fmt.Sprintf("https://fixture.test/slot%d.png", i)})
	}
	seen := make(chan map[string]any, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		seen <- body
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"succeeded","output_url":"https://fixture.test/factory.mp4"}`)
	}))
	defer upstream.Close()
	s.provider = newRelayProviderClient(upstream.URL, "fixture-key", nil)
	input := `{"imageIds":["201","202","204","205"],"imageSlots":[1,2,4,5]}`
	quote := quoteTemplate(t, s, row.ID, input)
	register := false
	dto := generateDTO{TemplateID: row.ID, TemplateQuote: quote.QuoteToken, ModelID: quote.ModelID, Handler: quote.Handler, Input: json.RawMessage(input), RegisterWork: &register, ClientRequestID: "factory-template-http"}
	vo, err := s.generate(context.Background(), 42, dto)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case body := <-seen:
		if body["mode"] != "multi_ref" || body["duration"] != float64(30) || body["ratio"] != "9:16" {
			t.Fatal("wrong upstream settings", body)
		}
		if !reflect.DeepEqual(body["image_urls"], []any{"https://fixture.test/slot1.png", "https://fixture.test/slot2.png", "https://fixture.test/slot4.png", "https://fixture.test/slot5.png"}) {
			t.Fatal("wrong upstream reference order", body["image_urls"])
		}
		prompt, _ := body["prompt"].(string)
		if !strings.Contains(prompt, "本人头像：未上传") || !strings.Contains(prompt, "真实产品与包装：@图3") || !strings.Contains(prompt, "实际生产车间：@图4") || strings.Contains(prompt, "{{image:") {
			t.Fatal("upstream reference roles incorrect")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("upstream not called")
	}
	var task model.AiTask
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		s.repo.db.First(&task, "id = ?", vo.ID)
		if task.Status != statusProcessing {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if task.Status != statusSuccess || strings.Contains(task.Input, "讲解人") || strings.Contains(task.ResultMeta, "讲解人") {
		t.Fatal("task failed or recipe leaked")
	}
	replay, err := s.generate(context.Background(), 42, dto)
	if err != nil || replay.ID != vo.ID {
		t.Fatal("replay did not recover original task", err)
	}
	var owner model.User
	s.repo.db.First(&owner, 42)
	if owner.Points != int64(100-quote.PointCost) {
		t.Fatal("duplicate debit")
	}
}

func TestThirtySecondPackAutoSelectsModelSupportingThirtySeconds(t *testing.T) {
	s, _, _ := templateFixture(t)
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Updates(map[string]any{"config": `{"modes":["omni_ref"],"durations":["15s"],"ratios":["9:16"]}`, "use_count": 9999})
	long := model.MarketModel{ModelKey: "long-video", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["omni_ref"],"durations":["15s","30s"],"ratios":["9:16"],"refLimits":{"omniRef.imageCount":6}}`}
	s.repo.db.Create(&long)
	var row model.StudioTemplate
	s.repo.db.Where("source_key = ?", studiotemplate.StoreFoodSourcePrefix+"hotpot-30s").First(&row)
	setup, err := CheckStudioTemplate(context.Background(), s.repo.db, row)
	if err != nil || setup.ModelID != "long-video" || setup.Options.Duration != 30 {
		t.Fatalf("wrong auto selection: %+v %v", setup, err)
	}
	s.repo.db.Model(&long).Update("config", `{"modes":["omni_ref"],"durations":["15s","30s"],"ratios":["9:16"],"refLimits":{"omniRef.imageCount":4}}`)
	if _, err := CheckStudioTemplate(context.Background(), s.repo.db, row); err == nil {
		t.Fatal("pack accepted model with too few reference slots")
	}
}

func TestTemplateAutoSelectionSkipsUnpricedDefaultWithoutChangingPinnedModel(t *testing.T) {
	s, _, _ := templateFixture(t)
	if err := studiotemplate.SeedContentPacks(s.repo.db); err != nil {
		t.Fatal(err)
	}
	common := `{"modes":["omni_ref"],"durations":["15s","30s"],"ratios":["9:16"],"resolutions":["1080p"],"videoBillingMode":"per_request","pricePerRequestByResolution":%s}`
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-video").Updates(map[string]any{"use_count": 9999, "config": fmt.Sprintf(common, `{}`)})
	priced := model.MarketModel{ModelKey: "priced-video", Name: "Seedance 2.5 priced", Type: "video", Status: 1, Config: fmt.Sprintf(common, `{"1080p":23}`)}
	if err := s.repo.db.Create(&priced).Error; err != nil {
		t.Fatal(err)
	}
	var row model.StudioTemplate
	s.repo.db.Where("source_key = ?", studiotemplate.StoreFoodSourcePrefix+"hotpot-30s").First(&row)
	setup, err := CheckStudioTemplate(context.Background(), s.repo.db, row)
	if err != nil || setup.ModelID != priced.ModelKey || setup.BasePointCost != 23 || setup.Options.Duration != 30 {
		t.Fatalf("auto-selection stopped at an unpriced model: %+v %v", setup, err)
	}
	row.ModelKey = "fixture-video"
	if _, err := CheckStudioTemplate(context.Background(), s.repo.db, row); err == nil {
		t.Fatal("explicit unpriced model silently replaced")
	}
}
