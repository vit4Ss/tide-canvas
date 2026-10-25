package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/model"
)

func TestTemplateDraftSaveFillsHeaderAndDefaultModel(t *testing.T) {
	s, _ := coverFixture(t)
	chosen := model.MarketModel{ModelKey: "seedance-2.5-test", Name: "Seedance 2.5", Type: "video", Status: 1, Config: `{"modes":["i2v"],"durations":["15s","30s"],"ratios":["16:9","9:16"],"resolutions":["480p","720p","1080p"]}`}
	if err := s.db.Create(&chosen).Error; err != nil {
		t.Fatal(err)
	}
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.POST("/", h.save)
	save := func() model.StudioTemplate {
		t.Helper()
		body := `{"kind":"inspiration","mediaType":"video","title":"门店宣传","mode":"i2v","prompt":"【生成视频：30秒｜9:16】\n门店镜头","requirements":{"images":1},"options":{},"status":0}`
		req := httptest.NewRequest("POST", "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var result struct {
			Success bool
			Data    model.StudioTemplate
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Success {
			t.Fatal(w.Body.String(), err)
		}
		var stored model.StudioTemplate
		if err := s.db.First(&stored, "id = ?", result.Data.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Options.Duration != 30 || stored.Options.AspectRatio != "9:16" || stored.Status != 0 {
			t.Fatal("draft defaults not saved", stored.Options)
		}
		return stored
	}
	if row := save(); row.ModelKey != chosen.ModelKey {
		t.Fatal("default model not saved", row.ModelKey)
	} else if row.Options.Resolution != "720p" {
		t.Fatal("default video resolution was not 720p", row.Options.Resolution)
	}
	if err := s.db.Model(&chosen).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if row := save(); row.ModelKey != "" {
		t.Fatal("unavailable model selected")
	}
	var count int64
	if err := s.db.Model(&model.AiTask{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("default filling generated a paid task", count, err)
	}
}
