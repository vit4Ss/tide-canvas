package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestTemplateFillSavesOnlyConfigurationAndRetriesSafely(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	for i, prompt := range []string{"【生成视频：30秒｜9:16】\n有效模板", "仅有描述", "【生成视频：30秒｜9:16】\n不可用模型"} {
		row := model.StudioTemplate{BaseModel: model.BaseModel{ID: idgen.ID(50 + i)}, Kind: "inspiration", MediaType: "video", Category: "batch-test", Title: prompt, Prompt: prompt, Mode: "i2v", Requirements: model.StudioTemplateRequirements{Images: 1}, CoverURL: "https://fixture.test/manual.png", Uses: 7, Status: 0}
		if i == 2 {
			row.ModelKey = "unavailable"
		}
		if err := s.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.POST("/", h.fillFromPrompts)
	call := func() map[string]int {
		t.Helper()
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"mediaType":"video","kind":"inspiration","category":"batch-test","status":"0"}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Success bool
			Data    struct {
				Total  int
				Counts map[string]int
				Items  []templateFillResult
			}
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || !body.Success || body.Data.Total != 3 {
			t.Fatal(w.Body.String(), err)
		}
		return body.Data.Counts
	}
	counts := call()
	if counts["saved"] != 1 || counts["skipped"] != 1 || counts["failed"] != 1 {
		t.Fatal(counts)
	}
	var row model.StudioTemplate
	if err := s.db.First(&row, "id = ?", 50).Error; err != nil {
		t.Fatal(err)
	}
	if row.ModelKey != m.ModelKey || row.Options.Duration != 30 || row.Options.AspectRatio != "9:16" ||
		row.CoverURL != "https://fixture.test/manual.png" || row.Uses != 7 || row.Status != 0 ||
		row.Prompt != "【生成视频：30秒｜9:16】\n有效模板" {
		t.Fatal("non-configuration data changed", row)
	}
	counts = call()
	if counts["saved"] != 0 || counts["skipped"] != 2 || counts["failed"] != 1 {
		t.Fatal("retry overwrote saved values", counts)
	}
	var excluded model.StudioTemplate
	s.db.First(&excluded, "id = ?", 1)
	if excluded.ModelKey != "" {
		t.Fatal("filter was ignored")
	}
	var tasks int64
	if err := s.db.Model(&model.AiTask{}).Count(&tasks).Error; err != nil || tasks != 0 {
		t.Fatal("fill generated a paid task", tasks, err)
	}
}

func TestTemplateFillPublishesReadyDraftsAndRejectsIncompleteOnes(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"already-filled", "needs-defaults", "no-cover", "bad-model", "bad-ratio", "blank-prompt", "no-header", "bad-requirements"} {
		row := model.StudioTemplate{BaseModel: model.BaseModel{ID: idgen.ID(70 + i)}, Kind: "inspiration", MediaType: "video", Category: "publish-test", Title: name,
			Prompt: "【生成视频：30秒｜9:16】\n门店宣传", Mode: "i2v", Requirements: model.StudioTemplateRequirements{Images: 1},
			CoverURL: "https://fixture.test/cover.png", Uses: 7, ModelKey: m.ModelKey, Options: model.StudioTemplateOptions{Duration: 30, AspectRatio: "9:16"}, Status: 0}
		switch name {
		case "needs-defaults":
			row.ModelKey = ""
			row.Options = model.StudioTemplateOptions{}
		case "no-cover":
			row.CoverURL = ""
			row.ModelKey = ""
		case "bad-model":
			row.ModelKey = "missing-model"
		case "bad-ratio":
			row.Options.AspectRatio = "1:1"
		case "blank-prompt":
			row.Prompt = " "
		case "no-header":
			row.Prompt = "根据上传的门店照片拍摄宣传片"
		case "bad-requirements":
			row.Requirements.Images = 2
		}
		if err := s.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.POST("/", h.fillFromPrompts)
	r.GET("/public", (&studiotemplate.Handler{DB: s.db}).List(false))
	call := func() map[string]int {
		t.Helper()
		req := httptest.NewRequest("POST", "/", strings.NewReader(`{"mediaType":"video","category":"publish-test","publish":true}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var result struct {
			Success bool
			Data    struct {
				Publish bool
				Total   int
				Counts  map[string]int
				Items   []templateFillResult
			}
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Success || !result.Data.Publish || result.Data.Total != 8 {
			t.Fatal(w.Body.String(), err)
		}
		for _, item := range result.Data.Items {
			if item.ID == 72 && !strings.Contains(item.Message, "封面") {
				t.Fatal("missing cover reason was lost", item)
			}
		}
		return result.Data.Counts
	}
	counts := call()
	if counts["published"] != 3 || counts["failed"] != 5 {
		t.Fatal("wrong publication counts", counts)
	}
	for i := 0; i < 8; i++ {
		var row model.StudioTemplate
		if err := s.db.First(&row, "id = ?", 70+i).Error; err != nil {
			t.Fatal(err)
		}
		want := 0
		if i == 0 || i == 1 || i == 6 {
			want = 1
		}
		if row.Status != want || row.Uses != 7 {
			t.Fatal("wrong persisted state", row.Title, row.Status)
		}
		if i == 2 && row.ModelKey != "" {
			t.Fatal("failed publication partially rewrote the model")
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/public?mediaType=video&category=publish-test", nil))
	var public struct{ Data struct{ Total int } }
	if err := json.Unmarshal(w.Body.Bytes(), &public); err != nil || public.Data.Total != 3 {
		t.Fatal("published rows missing from public list", w.Body.String(), err)
	}
	counts = call()
	if counts["published"] != 0 || counts["skipped"] != 3 || counts["failed"] != 5 {
		t.Fatal("retry republished unchanged rows", counts)
	}
	var tasks int64
	s.db.Model(&model.AiTask{}).Count(&tasks)
	var owner model.User
	s.db.First(&owner, "id = ?", 42)
	if tasks != 0 || owner.Points != 100 {
		t.Fatal("publication generated or charged", tasks, owner.Points)
	}
}

func TestSingleTemplateFillPublishesWithTheNormalCoverValidation(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	h := &studioTemplatesHandler{db: s.db}
	r.PUT("/:id", h.save)
	payload := `{"kind":"inspiration","mediaType":"video","title":"Published","prompt":"【生成视频：30秒｜9:16】","mode":"i2v","requirements":{"images":1},"status":1,"fillFromPrompt":true,"coverUrl":""}`
	for _, cover := range []string{"", "https://fixture.test/cover.png"} {
		body := strings.Replace(payload, `"coverUrl":""`, `"coverUrl":"`+cover+`"`, 1)
		req := httptest.NewRequest("PUT", "/1", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var row model.StudioTemplate
		s.db.First(&row, "id = ?", 1)
		if cover == "" {
			if row.Status != 0 || !strings.Contains(w.Body.String(), "封面") {
				t.Fatal("coverless template published", w.Body.String())
			}
		} else if row.Status != 1 || row.ModelKey != m.ModelKey || row.Options.Duration != 30 {
			t.Fatal("ready template did not publish", w.Body.String())
		}
	}
}

func TestSingleTemplateFillFailureDoesNotSaveIncompleteConfiguration(t *testing.T) {
	s, _ := coverFixture(t)
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.PUT("/:id", h.save)
	req := httptest.NewRequest("PUT", "/1", strings.NewReader(`{"kind":"inspiration","mediaType":"video","title":"Changed title","prompt":"【生成视频：30秒｜9:16】","mode":"i2v","requirements":{"images":1},"status":0,"fillFromPrompt":true}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if strings.Contains(w.Body.String(), `"success":true`) || !strings.Contains(w.Body.String(), "Seedance 2.5") {
		t.Fatal(w.Body.String())
	}
	var row model.StudioTemplate
	s.db.First(&row, "id = ?", 1)
	if row.Title != "Template 1" || row.Options.Duration != 0 || row.ModelKey != "" {
		t.Fatal("failed autofill partially saved", row)
	}
}

func TestTemplateStaleDraftCannotUndoConcurrentPublication(t *testing.T) {
	s, _ := coverFixture(t)
	if err := s.db.Model(&model.StudioTemplate{}).Where("id = ?", 1).Update("status", 1).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	h := &studioTemplatesHandler{db: s.db}
	r.PUT("/:id", h.save)
	call := func(expected int) string {
		t.Helper()
		payload := map[string]any{
			"kind": "inspiration", "mediaType": "video", "title": "Old editor change",
			"prompt": "门店宣传", "mode": "i2v", "requirements": map[string]int{"images": 1},
			"status": 0, "expectedStatus": expected,
		}
		raw, _ := json.Marshal(payload)
		req := httptest.NewRequest("PUT", "/1", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Body.String()
	}
	response := call(0)
	var row model.StudioTemplate
	s.db.First(&row, "id = ?", 1)
	if row.Status != 1 || row.Title != "Template 1" || !strings.Contains(response, "409") {
		t.Fatal("stale editor silently undid publication", response, row.Status, row.Title)
	}
	response = call(1)
	s.db.First(&row, "id = ?", 1)
	if row.Status != 0 || !strings.Contains(response, `"success":true`) {
		t.Fatal("intentional unpublish with a current baseline was rejected", response)
	}
	// Publication can also commit after the form reads its row but before the
	// save UPDATE. The status predicate must fence this interleaving.
	injected := false
	if err := s.db.Callback().Update().Before("gorm:update").Register("test:publish-during-save", func(tx *gorm.DB) {
		if injected || tx.Statement.Table != "studio_template" {
			return
		}
		injected = true
		if err := tx.Exec("UPDATE studio_template SET status = 1 WHERE id = ?", 1).Error; err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	response = call(0)
	s.db.First(&row, "id = ?", 1)
	if !injected || row.Status != 1 || !strings.Contains(response, "409") {
		t.Fatal("publication between read and write was lost", response, row.Status)
	}
}

func TestSingleTemplatePublicationAcceptsConfiguredRecipeWithoutHeader(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	h := &studioTemplatesHandler{db: s.db}
	r.PUT("/:id", h.save)
	req := httptest.NewRequest("PUT", "/1", strings.NewReader(`{"kind":"inspiration","mediaType":"video","title":"Ready recipe","prompt":"按参考照片生成门店宣传视频","mode":"i2v","modelKey":"seedance-2.5","requirements":{"images":1},"options":{"duration":30,"aspectRatio":"9:16"},"coverUrl":"https://fixture.test/cover.png","status":1,"fillFromPrompt":true,"expectedStatus":0}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var row model.StudioTemplate
	s.db.First(&row, "id = ?", 1)
	if row.Status != 1 || !strings.Contains(w.Body.String(), `"success":true`) {
		t.Fatal("single and batch publication have different eligibility rules", w.Body.String())
	}
}

func TestTemplateFillDoesNotPublishOutsideLiteralFilter(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"]}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		row := model.StudioTemplate{BaseModel: model.BaseModel{ID: idgen.ID(90 + i)}, Kind: "inspiration", MediaType: "video", Category: "scope", Title: "Shop_100%", Prompt: "【生成视频：30秒｜9:16】", Mode: "i2v", Requirements: model.StudioTemplateRequirements{Images: 1}, CoverURL: "https://fixture.test/cover.png", Status: 0}
		switch i {
		case 1:
			row.Status = 1
		case 2:
			row.Category = "other"
		case 3:
			row.MediaType = "image"
		case 4:
			row.Title = "ShopA100x"
		case 5:
			row.Kind = "style"
		}
		if err := s.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := gin.New()
	h := &studioTemplatesHandler{db: s.db}
	r.POST("/", h.fillFromPrompts)
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"kind":"inspiration","mediaType":"video","category":"scope","status":"0","keyword":"_100%","publish":true}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var result struct {
		Success bool
		Data    struct {
			Total  int
			Counts map[string]int
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Success || result.Data.Total != 1 || result.Data.Counts["published"] != 1 {
		t.Fatal("filter scope was broadened", w.Body.String(), err)
	}
	for i := 0; i < 6; i++ {
		var row model.StudioTemplate
		s.db.First(&row, "id = ?", 90+i)
		if i == 0 {
			if row.Status != 1 || row.ModelKey != m.ModelKey {
				t.Fatal("target was not published")
			}
		} else if row.ModelKey != "" || (i != 1 && row.Status != 0) {
			t.Fatal("out-of-scope template changed", i, row.Status, row.ModelKey)
		}
	}
}
