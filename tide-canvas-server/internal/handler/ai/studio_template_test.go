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

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type templateTestProvider struct {
	seen    chan GenerateRequest
	failure error
	urls    []string
}

func (p *templateTestProvider) Type() string { return "template-test" }
func (p *templateTestProvider) Generate(_ context.Context, req GenerateRequest) (GenerateResult, error) {
	p.seen <- req
	if p.failure != nil {
		return GenerateResult{}, p.failure
	}
	return GenerateResult{ResultURL: "https://fixture.test/result.png", URLs: p.urls, Meta: map[string]any{"prompt": req.Input["prompt"], "nested": req.Input}}, nil
}

func TestTemplateSelectedParametersReachProviderWithUserReferences(t *testing.T) {
	for _, media := range []string{"image", "video"} {
		t.Run(media, func(t *testing.T) {
			s, row, p := templateFixture(t)
			row.MediaType = media
			row.ModelKey = "fixture-" + media
			if media == "image" {
				row.Mode = "i2i"
				row.Options = model.StudioTemplateOptions{AspectRatio: "9:16", Resolution: "4k", Quality: "high", BatchCount: 3}
				s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2i"],"ratios":["1:1","9:16"],"resolutions":["2k","4k"],"qualities":["low","high"],"batchOptions":[1,4],"priceMatrix":{"low":{"2k":2,"4k":3},"high":{"2k":4,"4k":9}}}`)
				p.urls = []string{"https://fixture.test/result.png", "https://fixture.test/second.png", "https://fixture.test/third.png"}
			} else {
				row.Mode = "i2v"
				row.Options = model.StudioTemplateOptions{AspectRatio: "9:16", Resolution: "1080p", Duration: 4.5}
				s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2v"],"ratios":["16:9","9:16"],"resolutions":["720p","1080p"],"durations":["5s","4.5s"],"priceMatrix":{"5s":{"720p":10,"1080p":12},"4.5s":{"720p":11,"1080p":17}}}`)
			}
			if err := s.repo.db.Save(row).Error; err != nil {
				t.Fatal(err)
			}
			setup, err := CheckStudioTemplate(context.Background(), s.repo.db, *row)
			if err != nil {
				t.Fatal(err)
			}
			q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
			wantCost := 27
			if media == "video" {
				wantCost = 17
			}
			if q.PointCost != wantCost || q.Options != setup.Options {
				t.Fatalf("wrong authoritative quote: %+v", q)
			}
			register := false
			dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`), RegisterWork: &register}
			vo, err := s.generate(context.Background(), 42, dto)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case req := <-p.seen:
				if req.Input["prompt"] != row.Prompt || inputStr(req.Input, "resolution") != row.Options.Resolution || inputStr(req.Input, "aspectRatio") != "9:16" {
					t.Fatalf("lost saved recipe: %+v", req.Input)
				}
				if refs := inputImageURLs(req.Input); len(refs) != 1 || refs[0] != "https://fixture.test/input.png" {
					t.Fatalf("did not use user reference: %v", refs)
				}
				if media == "image" && (batchCount(req.Input) != 3 || req.Input["quality"] != "high") {
					t.Fatal("lost image quality/count")
				}
				if media == "video" && (durationSeconds(req.Input["duration"]) != 4.5 || req.Input["quality"] != nil) {
					t.Fatal("wrong video settings")
				}
			case <-time.After(4 * time.Second):
				t.Fatal("provider not called")
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
			var owner model.User
			s.repo.db.First(&owner, 42)
			if task.Status != statusSuccess || owner.Points != int64(100-wantCost) {
				t.Fatalf("wrong result/debit: %d %d", task.Status, owner.Points)
			}
			if strings.Contains(task.Input, row.Prompt) || strings.Contains(task.ResultMeta, row.Prompt) {
				t.Fatal("private recipe exposed")
			}
			if media == "image" && !strings.Contains(task.ResultMeta, "third.png") {
				t.Fatal("lost multi-image result")
			}
		})
	}
}

func TestTemplateVideoSettingsReachActualRelayHTTPWithoutTruncation(t *testing.T) {
	s, row, _ := templateFixture(t)
	seen := make(chan map[string]any, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openapi/v1/generations" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		seen <- body
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"succeeded","output_url":"https://fixture.test/output.mp4"}`)
	}))
	defer upstream.Close()
	s.provider = newRelayProviderClient(upstream.URL, "fixture-key", nil)
	row.MediaType = "video"
	row.Mode = "i2v"
	row.ModelKey = "fixture-video"
	row.Options = model.StudioTemplateOptions{AspectRatio: "9:16", Resolution: "1080p", Duration: 4.5}
	s.repo.db.Save(row)
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2v"],"ratios":["16:9","9:16"],"resolutions":["720p","1080p"],"durations":["10s","4.5s"],"priceMatrix":{"10s":{"720p":10,"1080p":12},"4.5s":{"720p":11,"1080p":17}}}`)
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	register := false
	vo, err := s.generate(context.Background(), 42, generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`), RegisterWork: &register})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case body := <-seen:
		for key, want := range map[string]any{"duration": 4.5, "ratio": "9:16", "resolution": "1080p", "image_url": "https://fixture.test/input.png", "model": "fixture-video", "mode": "image_to_video", "prompt": row.Prompt} {
			if body[key] != want {
				t.Errorf("actual HTTP %s=%v, want %v", key, body[key], want)
			}
		}
	case <-time.After(4 * time.Second):
		t.Fatal("relay HTTP was not called")
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
	var owner model.User
	s.repo.db.First(&owner, 42)
	if task.Status != statusSuccess || task.PointCost != 17 || owner.Points != 83 {
		t.Fatalf("wrong task or price: status=%d cost=%d balance=%d", task.Status, task.PointCost, owner.Points)
	}
}

func TestTemplateUnconfiguredOptionsAreNotSentAndHiddenBatchCannotChargeMultiple(t *testing.T) {
	s, row, _ := templateFixture(t)
	row.Options = model.StudioTemplateOptions{AspectRatio: "16:9", Resolution: "4k", Quality: "high", Duration: 10}
	s.repo.db.Save(row)
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2i"],"hideBatchCount":true}`)
	dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(`{"imageIds":["91"]}`)}
	if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err != nil {
		t.Fatal(err)
	}
	in := decodeInput(dto.Input)
	for _, key := range []string{"aspectRatio", "resolution", "quality", "duration"} {
		if _, ok := in[key]; ok {
			t.Fatalf("hidden %s sent to provider", key)
		}
	}
	if batchCount(in) != 1 {
		t.Fatal("hidden quantity not one")
	}
	row.Options.BatchCount = 3
	s.repo.db.Save(row)
	dto.Input = json.RawMessage(`{"imageIds":["91"]}`)
	if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err == nil {
		t.Fatal("hidden batch accepted multiple outputs")
	}
}

func TestTemplateModelSpecChangeRejectsSavedSettingBeforeDebit(t *testing.T) {
	s, row, p := templateFixture(t)
	row.Options = model.StudioTemplateOptions{Resolution: "2k", AspectRatio: "4:5"}
	s.repo.db.Save(row)
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2i"],"resolutions":["4k"],"ratios":["1:1"]}`)
	dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`)}
	if _, err := s.generate(context.Background(), 42, dto); err == nil {
		t.Fatal("silently changed saved output settings")
	}
	var owner model.User
	s.repo.db.First(&owner, 42)
	if owner.Points != 100 || len(p.seen) != 0 {
		t.Fatal("incompatible recipe charged/generated")
	}
}

func TestTemplateFailedGenerationRefundsOnceAndKeepsPrivateRecipeOutOfErrors(t *testing.T) {
	s, row, p := templateFixture(t)
	p.failure = fmt.Errorf("upstream rejected private payload %s", row.Prompt)
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	register := false
	dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`), RegisterWork: &register, ClientRequestID: "failure-replay"}
	vo, err := s.generate(context.Background(), 42, dto)
	if err != nil {
		t.Fatal(err)
	}
	var task model.AiTask
	var owner model.User
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.repo.db.First(&task, "id = ?", vo.ID)
		s.repo.db.First(&owner, 42)
		if task.Status == statusFailed && owner.Points == 100 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if task.Status != statusFailed || owner.Points != 100 {
		t.Fatalf("failed task not refunded: status %d points %d", task.Status, owner.Points)
	}
	raw, _ := json.Marshal(toTaskVO(&task))
	if strings.Contains(string(raw), row.Prompt) {
		t.Fatal("failure leaked private template")
	}
	for range 2 {
		replay, err := s.generate(context.Background(), 42, dto)
		if err != nil || replay.ID != vo.ID {
			t.Fatalf("failed task replay: %v", err)
		}
	}
	s.repo.db.First(&owner, 42)
	s.repo.db.First(row, row.ID)
	if owner.Points != 100 || row.Uses != 1 || len(p.seen) != 1 {
		t.Fatal("failed-task retry resubmitted, charged, or refunded twice")
	}
}

func TestOperatorPreflightRejectsUnusableRecipesWithoutGenerating(t *testing.T) {
	s, original, provider := templateFixture(t)
	for _, tc := range []struct {
		name   string
		mutate func(*model.StudioTemplate)
	}{
		{"missing prompt", func(r *model.StudioTemplate) { r.Prompt = "" }},
		{"missing model", func(r *model.StudioTemplate) { r.ModelKey = "unknown" }},
		{"wrong mode", func(r *model.StudioTemplate) { r.Mode = "t2i"; r.Requirements.Images = 0 }},
		{"unsupported ratio", func(r *model.StudioTemplate) { r.Options.AspectRatio = "16:9" }},
		{"unsupported resolution", func(r *model.StudioTemplate) { r.Options.Resolution = "8k" }},
		{"unsupported quality", func(r *model.StudioTemplate) { r.Options.Quality = "unknown" }},
		{"unsupported duration", func(r *model.StudioTemplate) {
			r.MediaType = "video"
			r.Mode = "ref"
			r.ModelKey = "fixture-video"
			r.Options.Duration = 99
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := *original
			tc.mutate(&row)
			if _, err := CheckStudioTemplate(context.Background(), s.repo.db, row); err == nil {
				t.Fatal("bad recipe passed preflight")
			}
		})
	}
	row := *original
	row.Status = 0
	row.Options.Quality = "HIGH"
	setup, err := CheckStudioTemplate(context.Background(), s.repo.db, row)
	if err != nil || setup.Options.Quality != "high" || setup.BasePointCost != 7 {
		t.Fatalf("valid draft failed: %+v %v", setup, err)
	}
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["i2i"],"maxRefImages":1}`)
	row.Requirements.Images = 2
	if _, err := CheckStudioTemplate(context.Background(), s.repo.db, row); err == nil {
		t.Fatal("over-limit material count passed")
	}
	var count int64
	s.repo.db.Model(&model.AiTask{}).Count(&count)
	var owner model.User
	s.repo.db.First(&owner, 42)
	if count != 0 || owner.Points != 100 || len(provider.seen) != 0 {
		t.Fatal("preflight generated or charged")
	}
}

func TestTemplateDefaultModelControlsQuoteAndSubmissionWithoutFallback(t *testing.T) {
	for _, byID := range []bool{false, true} {
		t.Run(fmt.Sprintf("storedByID=%t", byID), func(t *testing.T) {
			s, row, provider := templateFixture(t)
			ctx := context.Background()
			chosen := model.MarketModel{Name: "Operator chosen model", ModelKey: "chosen-image", Type: "image", Status: 1, Price: decimal.NewFromInt(19), Config: `{"modes":["i2i"],"ratios":["1:1"],"resolutions":["4k"]}`}
			if err := s.repo.db.Create(&chosen).Error; err != nil {
				t.Fatal(err)
			}
			// The default must win even when a different model is more popular.
			if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("use_count", 1000).Error; err != nil {
				t.Fatal(err)
			}
			row.ModelKey = chosen.ModelKey
			if byID {
				row.ModelKey = chosen.ID.String()
			}
			if err := s.repo.db.Save(row).Error; err != nil {
				t.Fatal(err)
			}
			setup, err := CheckStudioTemplate(ctx, s.repo.db, *row)
			if err != nil || setup.ModelID != chosen.ModelKey || setup.Options.Resolution != "4k" || setup.BasePointCost != 19 {
				t.Fatalf("preflight ignored default model: %+v %v", setup, err)
			}
			q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
			if q.ModelID != chosen.ModelKey || q.PointCost != 19 {
				t.Fatalf("quote ignored default model or its price: %+v", q)
			}
			dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: "fixture-image", Input: json.RawMessage(`{"imageIds":["91"]}`)}
			if err := s.prepareTemplateGeneration(ctx, 42, &dto); err != nil || dto.ModelID != chosen.ModelKey {
				t.Fatalf("client overrode default model: %s %v", dto.ModelID, err)
			}
			if err := s.repo.db.Model(&chosen).Update("status", 2).Error; err != nil {
				t.Fatal(err)
			}
			dto.Input = json.RawMessage(`{"imageIds":["91"]}`)
			if _, err := s.generate(ctx, 42, dto); err == nil {
				t.Fatal("unavailable default silently fell back to another model")
			}
			var owner model.User
			if err := s.repo.db.First(&owner, 42).Error; err != nil {
				t.Fatal(err)
			}
			var count int64
			if err := s.repo.db.Model(&model.AiTask{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if owner.Points != 100 || count != 0 || len(provider.seen) != 0 {
				t.Fatal("unavailable default charged or created a generation")
			}
		})
	}
}

func TestTemplateReferenceVideoQuoteRevalidatesActualDurationBeforeCharging(t *testing.T) {
	s, row, provider := templateFixture(t)
	row.MediaType = "video"
	row.Mode = "ref"
	row.ModelKey = "fixture-video"
	row.Requirements = model.StudioTemplateRequirements{Videos: 1}
	row.Options = model.StudioTemplateOptions{Duration: 5, Resolution: "720p"}
	s.repo.db.Save(row)
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", row.ModelKey).Update("config", `{"modes":["omni_ref"],"referenceVideoBillingEnabled":true,"durations":["4s","5s","7s"],"resolutions":["720p"],"priceMatrix":{"4s":{"720p":28},"5s":{"720p":35},"7s":{"720p":49}}}`)
	duration := 4.2
	s.confirmVideoDuration = func(_ context.Context, uid idgen.ID, url string) (string, float64, error) {
		if uid != 42 || url != "https://fixture.test/input.mp4" {
			t.Error("unexpected video lookup")
		}
		return url, duration, nil
	}
	q := quoteTemplate(t, s, row.ID, `{"videoIds":["93"]}`)
	if q.BasePointCost != 35 || q.ReferencePointCost != 35 || q.PointCost != 70 {
		t.Fatalf("wrong reference quote: %+v", q)
	}
	register := false
	dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"videoIds":["93"]}`), RegisterWork: &register, ClientRequestID: "priced-template"}
	duration = 6
	if _, err := s.generate(context.Background(), 42, dto); err == nil {
		t.Fatal("changed video duration accepted old quote")
	}
	var owner model.User
	s.repo.db.First(&owner, 42)
	if owner.Points != 100 || len(provider.seen) != 0 {
		t.Fatal("changed quote charged/generated")
	}
	duration = 4.2
	vo, err := s.generate(context.Background(), 42, dto)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-provider.seen:
	case <-time.After(4 * time.Second):
		t.Fatal("provider not called")
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
	s.repo.db.First(&owner, 42)
	if task.Status != statusSuccess || task.PointCost != 70 || owner.Points != 30 {
		t.Fatalf("quote differs from final debit: task=%+v points=%d", task, owner.Points)
	}
}

func TestTemplateGenerationModesPreserveOrderedMaterialsAndQuotedCost(t *testing.T) {
	for _, tc := range []struct {
		mode, media, handler, input string
		requirements                model.StudioTemplateRequirements
		images                      []string
	}{
		{"t2i", "image", "text_to_image", `{}`, model.StudioTemplateRequirements{}, nil},
		{"i2i", "image", "image_to_image", `{"imageIds":["95","91"]}`, model.StudioTemplateRequirements{Images: 2}, []string{"https://fixture.test/second.png", "https://fixture.test/input.png"}},
		{"t2v", "video", "text_to_video", `{}`, model.StudioTemplateRequirements{}, nil},
		{"i2v", "video", "image_to_video", `{"imageIds":["91"]}`, model.StudioTemplateRequirements{Images: 1}, []string{"https://fixture.test/input.png"}},
		{"flf", "video", "start_end_to_video", `{"imageIds":["95","91"]}`, model.StudioTemplateRequirements{Images: 2}, []string{"https://fixture.test/second.png", "https://fixture.test/input.png"}},
		{"ref", "video", "reference_to_video", `{"imageIds":["91"],"videoIds":["93"],"audioIds":["94"]}`, model.StudioTemplateRequirements{Images: 1, Videos: 1, Audio: 1}, []string{"https://fixture.test/input.png"}},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			s, row, provider := templateFixture(t)
			s.repo.db.Create(&model.File{ID: 95, OwnerID: 42, FileUrl: "https://fixture.test/second.png", FileType: "image"})
			s.repo.db.Model(&model.MarketModel{}).Where("type = ?", "image").Update("config", `{"modes":["i2i","t2i"]}`)
			s.repo.db.Model(&model.MarketModel{}).Where("type = ?", "video").Update("config", `{"modes":["t2v","i2v","keyframe","omni_ref"],"durations":["5s"]}`)
			row.MediaType = tc.media
			row.Mode = tc.mode
			row.ModelKey = "fixture-" + tc.media
			row.Requirements = tc.requirements
			if err := s.repo.db.Save(row).Error; err != nil {
				t.Fatal(err)
			}
			q := quoteTemplate(t, s, row.ID, tc.input)
			register := false
			dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(tc.input), RegisterWork: &register, ClientRequestID: "mode-check"}
			vo, err := s.generate(context.Background(), 42, dto)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case req := <-provider.seen:
				if req.Handler != tc.handler || req.Input["prompt"] != row.Prompt || req.Model.ModelID != row.ModelKey {
					t.Fatalf("wrong provider request: %+v", req)
				}
				images := inputImageURLs(req.Input)
				if len(images) != len(tc.images) || len(images) > 0 && !reflect.DeepEqual(images, tc.images) {
					t.Fatalf("material order changed: %v", images)
				}
				if tc.mode == "flf" && !reflect.DeepEqual(startEndFrames(req.Input), tc.images) {
					t.Fatal("first/last frame order changed")
				}
				if tc.mode == "ref" && (len(inputStrings(req.Input, "videoReferences")) != 1 || len(inputStrings(req.Input, "audioReferences")) != 1) {
					t.Fatal("lost multimodal materials")
				}
			case <-time.After(4 * time.Second):
				t.Fatal("provider not reached")
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
			if task.Status != statusSuccess || task.PointCost != int64(q.PointCost) {
				t.Fatalf("task result mismatch: %+v", task)
			}
			var owner model.User
			s.repo.db.First(&owner, 42)
			if owner.Points != int64(100-q.PointCost) {
				t.Fatalf("quote and debit differ: %d %d", q.PointCost, owner.Points)
			}
		})
	}
}

func templateFixture(t *testing.T) (*service, *model.StudioTemplate, *templateTestProvider) {
	t.Helper()
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.StudioTemplate{}, &model.File{}, &model.MarketModel{}, &model.AiHandler{}, &model.AiProvider{}, &model.AiTool{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: 42, Username: "template-user", Email: "templates@test", Status: 1, Points: 100},
		&model.MarketModel{Name: "Fixture Image", ModelKey: "fixture-image", Type: "image", Status: 1, Price: decimal.NewFromInt(7), Config: `{"modes":["i2i"],"resolutions":["2k"],"ratios":["4:5"],"qualities":["high"]}`},
		&model.MarketModel{Name: "Fixture Video", ModelKey: "fixture-video", Type: "video", Status: 1, Price: decimal.NewFromInt(12), Config: `{"modes":["omni_ref","keyframe"],"durations":["5s"],"resolutions":["720p"]}`},
		&model.File{ID: 91, OwnerID: 42, FileUrl: "https://fixture.test/input.png", FileType: "image", MimeType: "image/png"},
		&model.File{ID: 92, OwnerID: 43, FileUrl: "https://fixture.test/private.png", FileType: "image"},
		&model.File{ID: 93, OwnerID: 42, FileUrl: "https://fixture.test/input.mp4", FileType: "video", MimeType: "video/mp4"},
		&model.File{ID: 94, OwnerID: 42, FileUrl: "https://fixture.test/input.mp3", FileType: "other", MimeType: "audio/mpeg"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	row := &model.StudioTemplate{Kind: "inspiration", MediaType: "image", Title: "Fixture Template", Prompt: "PRIVATE_TEMPLATE_RECIPE", Mode: "i2i", ModelKey: "fixture-image", Status: 1, Requirements: model.StudioTemplateRequirements{Images: 1}}
	if err := db.Create(row).Error; err != nil {
		t.Fatal(err)
	}
	provider := &templateTestProvider{seen: make(chan GenerateRequest, 4)}
	s := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: provider, sem: make(chan struct{}, 4)}
	return s, row, provider
}

func quoteTemplate(t *testing.T, s *service, id idgen.ID, input string) templateQuoteVO {
	t.Helper()
	engine := gin.New()
	engine.POST("/quote", func(c *gin.Context) { c.Set(middleware.CtxUserID, idgen.ID(42)); (&handler{svc: s}).templateQuote(c) })
	r := httptest.NewRequest(http.MethodPost, "/quote", strings.NewReader(fmt.Sprintf(`{"templateId":"%s","input":%s}`, id, input)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, r)
	var out response.Result[templateQuoteVO]
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || !out.Success {
		t.Fatalf("quote failed: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "PRIVATE_TEMPLATE") {
		t.Fatal("quote exposed recipe")
	}
	return out.Data
}

func TestPrivateTemplateGenerateAndReplayDoNotExposeRecipeOrDoubleCharge(t *testing.T) {
	s, row, p := templateFixture(t)
	ctx := context.Background()
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	if q.PointCost != 7 {
		t.Fatalf("wrong price: %+v", q)
	}
	register := false
	dto := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`), ClientRequestID: "template-once", RegisterWork: &register}
	vo, err := s.generate(ctx, 42, dto)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case req := <-p.seen:
		if req.Input["prompt"] != row.Prompt {
			t.Fatal("provider did not receive private recipe")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("provider was not called")
	}
	var task model.AiTask
	var logs []model.AiGenerationLog
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.repo.db.First(&task, "id = ?", vo.ID)
		s.repo.db.Find(&logs, "task_id = ?", vo.ID)
		if task.Status != statusProcessing && len(logs) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if task.Status != statusSuccess || len(logs) != 1 {
		t.Fatalf("task not completed: %+v", task)
	}
	for _, value := range []any{vo, toTaskVO(&task), toUserHistoryDetail(&logs[0], &task)} {
		raw, _ := json.Marshal(value)
		if strings.Contains(string(raw), row.Prompt) {
			t.Fatalf("private recipe leaked: %T", value)
		}
	}
	if strings.Contains(task.Input, "prompt") || strings.Contains(task.ResultMeta, row.Prompt) || strings.Contains(logs[0].InputParams, row.Prompt) {
		t.Fatal("private recipe persisted in public records")
	}
	// A previously accepted task remains recoverable even after unpublishing.
	s.repo.db.Model(row).Update("status", 0)
	replay, err := s.generate(ctx, 42, dto)
	if err != nil || replay.ID != vo.ID {
		t.Fatalf("replay failed %v", err)
	}
	var owner model.User
	s.repo.db.First(&owner, 42)
	s.repo.db.First(row, row.ID)
	if owner.Points != 93 || row.Uses != 1 {
		t.Fatalf("duplicate debit or count: points=%d uses=%d", owner.Points, row.Uses)
	}
	dto.ClientRequestID = "new-click"
	if _, err := s.generate(ctx, 42, dto); err == nil {
		t.Fatal("unpublished template accepted")
	}
}

func TestTemplateRejectsTamperingForeignUploadsAndChangedQuoteBeforeDebit(t *testing.T) {
	s, row, _ := templateFixture(t)
	ctx := context.Background()
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	base := generateDTO{TemplateID: row.ID, TemplateQuote: q.QuoteToken, ModelID: q.ModelID, Handler: q.Handler, Input: json.RawMessage(`{"imageIds":["91"]}`)}
	for _, input := range []string{`{}`, `{"imageIds":["92"]}`, `{"imageIds":["93"]}`, `{"imageIds":["91"],"prompt":"override"}`, `{"imageIds":["91"],"batchCount":9}`, `{"imageUrls":["https://foreign.test/a.png"]}`, `{"imageIds":["91","91"]}`} {
		dto := base
		dto.Input = json.RawMessage(input)
		if _, err := s.generate(ctx, 42, dto); err == nil {
			t.Fatalf("bad input accepted: %s", input)
		}
	}
	dto := base
	dto.TemplateQuote = "forged"
	if _, err := s.generate(ctx, 42, dto); err == nil {
		t.Fatal("forged quote accepted")
	}
	if _, err := s.generate(ctx, 43, base); err == nil {
		t.Fatal("quote reused by other account")
	}
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("price", 20)
	if _, err := s.generate(ctx, 42, base); err == nil {
		t.Fatal("old price quote accepted")
	}
	var owner model.User
	var count int64
	s.repo.db.First(&owner, 42)
	s.repo.db.Model(&model.AiTask{}).Count(&count)
	if owner.Points != 100 || count != 0 {
		t.Fatal("rejected request charged or created task")
	}
}

func TestTemplateVideoAndAudioUploadsUseOwnedCanonicalMedia(t *testing.T) {
	s, row, _ := templateFixture(t)
	row.MediaType = "video"
	row.Mode = "ref"
	row.ModelKey = "fixture-video"
	row.Requirements = model.StudioTemplateRequirements{Videos: 1, Audio: 1}
	s.repo.db.Save(row)
	q := quoteTemplate(t, s, row.ID, `{"videoIds":["93"],"audioIds":["94"]}`)
	if q.PointCost != 12 || q.Handler != "reference_to_video" {
		t.Fatalf("invalid video quote: %+v", q)
	}
	dto := generateDTO{TemplateID: row.ID, ModelID: q.ModelID, Input: json.RawMessage(`{"videoIds":["93"],"audioIds":["94"]}`)}
	if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(dto.Input), "input.mp3") || !strings.Contains(string(dto.Input), "input.mp4") {
		t.Fatal("lost audio/video references")
	}
	// Other users generating the template must not invalidate an existing quote.
	s.repo.db.Model(row).UpdateColumn("uses", 5)
	next := quoteTemplate(t, s, row.ID, `{"videoIds":["93"],"audioIds":["94"]}`)
	if q.QuoteToken != next.QuoteToken {
		t.Fatal("usage counters invalidate quotes")
	}
}

func TestTemplateSameImageLoopPreservesBothFramesAndOtherSlotsRejectDuplicates(t *testing.T) {
	s, row, _ := templateFixture(t)
	row.Requirements.Images = 2
	s.repo.db.Save(row)
	dto := generateDTO{TemplateID: row.ID, Input: json.RawMessage(`{"imageIds":["91","91"]}`)}
	if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err == nil || !strings.Contains(err.Error(), "同一份素材") {
		t.Fatalf("duplicate role images silently collapsed: %v", err)
	}
	row.MediaType = "video"
	row.Mode = "flf"
	row.ModelKey = "fixture-video"
	s.repo.db.Save(row)
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91","91"]}`)
	dto = generateDTO{TemplateID: row.ID, ModelID: q.ModelID, Input: json.RawMessage(`{"imageIds":["91","91"]}`)}
	if err := s.prepareTemplateGeneration(context.Background(), 42, &dto); err != nil {
		t.Fatalf("same-image loop rejected: %v", err)
	}
	if err := validateRequiredReferenceInput(&dto); err != nil {
		t.Fatalf("loop missing last frame: %v", err)
	}
	if frames := startEndFrames(decodeInput(dto.Input)); !reflect.DeepEqual(frames, []string{"https://fixture.test/input.png", "https://fixture.test/input.png"}) {
		t.Fatalf("loop lost a frame: %v", frames)
	}
}

func TestTemplateSetupDisclosesEffectiveSpecWithoutMintingPaidQuote(t *testing.T) {
	s, row, _ := templateFixture(t)
	row.Options = model.StudioTemplateOptions{Resolution: "2k", AspectRatio: "4:5", Quality: "HIGH"}
	s.repo.db.Save(row)
	engine := gin.New()
	engine.GET("/setup/:id", (&handler{svc: s}).templateSetup)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest("GET", "/setup/"+row.ID.String(), nil))
	var responseBody response.Result[templateSetupVO]
	if err := json.Unmarshal(w.Body.Bytes(), &responseBody); err != nil || !responseBody.Success {
		t.Fatal(w.Body.String())
	}
	setup := responseBody.Data
	if setup.Options.Resolution != "2k" || setup.Options.AspectRatio != "4:5" || setup.Options.Quality != "high" || setup.BasePointCost != 7 {
		t.Fatalf("setup misrepresented resolved output: %+v", setup)
	}
	if strings.Contains(w.Body.String(), row.Prompt) || strings.Contains(w.Body.String(), "quoteToken") {
		t.Fatal("setup leaked private recipe or minted executable quote")
	}
	q := quoteTemplate(t, s, row.ID, `{"imageIds":["91"]}`)
	if q.Options != setup.Options || q.BasePointCost != 7 || q.ReferencePointCost != 0 {
		t.Fatalf("quote differs from resolved spec: %+v", q)
	}
	var count int64
	s.repo.db.Model(&model.AiTask{}).Count(&count)
	if count != 0 {
		t.Fatal("setup/quote created a paid task")
	}
	if setup.MaxUploadBytes["image"] != 50*1024*1024 {
		t.Fatal("wrong upload bound")
	}
	s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", `{"modes":["i2i"],"maxRefImageSizeMB":2}`)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest("GET", "/setup/"+row.ID.String(), nil))
	json.Unmarshal(w.Body.Bytes(), &responseBody)
	if responseBody.Data.MaxUploadBytes["image"] != 2*1024*1024 {
		t.Fatal("model upload restriction not exposed")
	}
}
