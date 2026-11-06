package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestTemplateFillClearsTemplateResolutionForUserSelection(t *testing.T) {
	s, _ := coverFixture(t)
	m := model.MarketModel{ModelKey: "seedance-2.5", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"],"resolutions":["480p","720p","1080p"],"videoBillingMode":"per_request","pricePerRequestByResolution":{"480p":3,"720p":7,"1080p":11}}`}
	if err := s.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	unsupported := model.MarketModel{ModelKey: "480-only", Name: "480 only", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["30s"],"ratios":["9:16"],"resolutions":["480p"]}`}
	if err := s.db.Create(&unsupported).Error; err != nil {
		t.Fatal(err)
	}
	for i, resolution := range []string{"480p", "", "480", " 480P ", "1080p", "480p"} {
		row := model.StudioTemplate{BaseModel: model.BaseModel{ID: idgen.ID(100 + i)}, Kind: "inspiration", MediaType: "video", Category: "resolution-test", Title: "Template",
			Prompt: "【生成视频：30秒｜9:16】", Mode: "i2v", ModelKey: m.ModelKey, Requirements: model.StudioTemplateRequirements{Images: 1},
			Options: model.StudioTemplateOptions{Duration: 30, AspectRatio: "9:16", Resolution: resolution}, CoverURL: "https://fixture.test/cover.png", Status: 1}
		if i == 5 {
			row.ModelKey = unsupported.ModelKey
		}
		if err := s.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.POST("/batch", h.fillFromPrompts)
	r.PUT("/:id", h.save)
	r.POST("/check", h.check)
	call := func(method, path, body string) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Body.Bytes()
	}
	for attempt := 0; attempt < 2; attempt++ {
		raw := call("POST", "/batch", `{"mediaType":"video","category":"resolution-test","status":"1","publish":true}`)
		var result struct {
			Success bool
			Data    struct {
				Counts map[string]int
				Items  []templateFillResult
			}
		}
		if err := json.Unmarshal(raw, &result); err != nil || !result.Success {
			t.Fatal(string(raw), err)
		}
		// The template which already has no fixed resolution is unchanged.
		wantUpdated := 5
		if attempt == 1 {
			wantUpdated = 0
		}
		if result.Data.Counts["published"] != wantUpdated || result.Data.Counts["failed"] != 0 || result.Data.Counts["skipped"] != 6-wantUpdated {
			t.Fatal(result.Data.Counts)
		}
	}
	for i := 0; i < 6; i++ {
		var row model.StudioTemplate
		s.db.First(&row, "id = ?", 100+i)
		if row.Options.Resolution != "" || row.Status != 1 {
			t.Fatal("wrong refresh", i, row.Options, row.Status)
		}
	}
	payload := `{"kind":"inspiration","mediaType":"video","title":"Single refresh","prompt":"【生成视频：30秒｜9:16】","mode":"i2v","modelKey":"seedance-2.5","requirements":{"images":1},"options":{"duration":30,"aspectRatio":"9:16","resolution":"480p"},"coverUrl":"https://fixture.test/cover.png","status":1,"expectedStatus":1,"fillFromPrompt":true}`
	if raw := call("PUT", "/100", payload); strings.Contains(string(raw), `"resolution"`) {
		t.Fatal("single fill persisted a template resolution", string(raw))
	}
	if raw := call("POST", "/check", payload); !strings.Contains(string(raw), `"resolution":"480p"`) || !strings.Contains(string(raw), `"basePointCost":3`) {
		t.Fatal("preview did not use the model's first resolution", string(raw))
	}
	// Ordinary saves also clear legacy template-level resolution.
	manual := strings.Replace(payload, `"fillFromPrompt":true`, `"fillFromPrompt":false`, 1)
	if raw := call("PUT", "/100", manual); strings.Contains(string(raw), `"resolution"`) {
		t.Fatal("ordinary save persisted a template resolution", string(raw))
	}
	var tasks int64
	s.db.Model(&model.AiTask{}).Count(&tasks)
	var user model.User
	s.db.First(&user, "id = ?", 42)
	if tasks != 0 || user.Points != 100 {
		t.Fatal("refresh generated or charged", tasks, user.Points)
	}
}
