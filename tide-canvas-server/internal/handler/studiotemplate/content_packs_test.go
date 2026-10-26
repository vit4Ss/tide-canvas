package studiotemplate

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
)

func TestSuppliedContentPackImportsTwentyPrivateDraftsOnce(t *testing.T) {
	entries, err := storeFoodEntries()
	if err != nil {
		t.Fatal(err)
	}
	durations := map[float64]int{}
	industries := map[string]int{}
	for _, entry := range entries {
		tpl := entry.Template
		durations[tpl.Options.Duration]++
		industries[strings.Split(tpl.Title, " · ")[0]]++
		if tpl.Options.AspectRatio != "9:16" || tpl.Requirements.Images != 6 || tpl.Mode != "ref" || tpl.Status != 0 || tpl.CoverURL != "" || tpl.PreviewURL != "" {
			t.Fatalf("wrong import: %+v", tpl)
		}
		if !strings.Contains(tpl.Prompt, "{{image:3}}") || strings.Contains(tpl.Prompt, "@图3") || !strings.Contains(tpl.Prompt, "不填写店名或厂名") {
			t.Fatal("lost source intent or unsafe image numbering")
		}
		if len(tpl.InputLabels.Images) != 6 {
			t.Fatal("missing slot labels")
		}
		if tpl.Category == "食品工厂" {
			if len(tpl.Requirements.OptionalImages) != 2 {
				t.Fatal("factory product/workshop must be required")
			}
		} else if len(tpl.Requirements.OptionalImages) != 4 {
			t.Fatal("store optional roles lost")
		}
	}
	if durations[15] != 10 || durations[30] != 10 || len(industries) != 10 {
		t.Fatalf("incomplete pack: %v %v", durations, industries)
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	defer pool.Close()
	if err := db.AutoMigrate(&model.StudioTemplate{}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := SeedContentPacks(db); err != nil {
			t.Fatal(err)
		}
	}
	var rows []model.StudioTemplate
	db.Where("source_key LIKE ?", StoreFoodSourcePrefix+"%").Order("sort_order").Find(&rows)
	if len(rows) != 20 {
		t.Fatalf("imported %d rows", len(rows))
	}
	r := gin.New()
	h := &Handler{DB: db}
	r.GET("/public", h.List(false))
	r.GET("/admin", h.List(true))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/public", nil))
	var result struct {
		Data struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Data.Total != 0 || strings.Contains(w.Body.String(), "讲解人") {
		t.Fatal("unfinished pack was publicly listed")
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/admin?mediaType=video&kind=inspiration", nil))
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Data.Total != 100 || !strings.Contains(w.Body.String(), "完整承接") {
		t.Fatal("operator cannot find/edit the pack")
	}
	db.Model(&rows[0]).Updates(map[string]any{"title": "运营调整", "prompt": "新配方", "uses": 9, "status": 1})
	db.Delete(&rows[1])
	if err := SeedContentPacks(db); err != nil {
		t.Fatal(err)
	}
	var edited model.StudioTemplate
	db.First(&edited, "id = ?", rows[0].ID)
	if edited.Title != "运营调整" || edited.Prompt != "新配方" || edited.Uses != 9 || edited.Status != 1 {
		t.Fatal("restart overwrote curation")
	}
	var count int64
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 99 {
		t.Fatal("deleted pack entry was resurrected")
	}
}

func TestOptionalImageConfigurationValidation(t *testing.T) {
	base := SaveDTO{Kind: "inspiration", MediaType: "video", Title: "模板", Mode: "ref", Prompt: "人物{{image:3}}", Requirements: model.StudioTemplateRequirements{Images: 6, OptionalImages: []int{3, 4, 5, 6}}}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, positions := range [][]int{{0}, {7}, {3, 3}, {1, 2, 3, 4, 5, 6}} {
		dto := base
		dto.Requirements.OptionalImages = positions
		if err := dto.Validate(); err == nil {
			t.Fatalf("bad optional positions accepted: %v", positions)
		}
	}
	for _, prompt := range []string{"{{image:7}}", "{{image:0}}", "{{image:abc}}"} {
		dto := base
		dto.Prompt = prompt
		if err := dto.Validate(); err == nil {
			t.Fatalf("bad reference accepted: %s", prompt)
		}
	}
	for _, prompt := range []string{"用图片3的人物搭配{{image:4}}", "用@图3的人物搭配{{image:4}}", "用图 3的人物搭配{{image:4}}"} {
		dto := base
		dto.Prompt = prompt
		if err := dto.Validate(); err == nil {
			t.Fatalf("ambiguous optional image numbering accepted: %s", prompt)
		}
	}
}

func TestEveryContentRecipeOptionalCombinationKeepsReferencesBounded(t *testing.T) {
	entries, err := storeFoodEntries()
	if err != nil {
		t.Fatal(err)
	}
	refs := regexp.MustCompile(`@图([0-9]+)`)
	tested := 0
	for _, entry := range entries {
		row := entry.Template.Row()
		optional := row.Requirements.OptionalImages
		for mask := 0; mask < (1 << len(optional)); mask++ {
			positions := []int{}
			for slot := 1; slot <= row.Requirements.Images; slot++ {
				present := true
				for i, n := range optional {
					if slot == n {
						present = mask&(1<<i) != 0
					}
				}
				if present {
					positions = append(positions, slot)
				}
			}
			prompt := model.ResolveTemplateImageReferences(row, positions)
			if strings.Contains(prompt, "{{image:") {
				t.Fatal("unexpanded reference", entry.Slug, mask)
			}
			for _, match := range refs.FindAllStringSubmatch(prompt, -1) {
				n, _ := strconv.Atoi(match[1])
				if n < 1 || n > len(positions) {
					t.Fatal("invalid actual image number", entry.Slug, mask, n)
				}
			}
			if utf8.RuneCountInString(prompt) > model.TemplatePromptMaxRunes(row) {
				t.Fatal("preflight underestimated optional prompt length", entry.Slug, mask)
			}
			for index, slot := range positions {
				want := row.InputLabels.Images[slot-1] + "：@图" + strconv.Itoa(index+1) + "（"
				if !strings.Contains(prompt, want) {
					t.Fatal("slot role lost", entry.Slug, mask, slot)
				}
			}
			for i, slot := range optional {
				if mask&(1<<i) == 0 && !strings.Contains(prompt, row.InputLabels.Images[slot-1]+"：未上传") {
					t.Fatal("missing role not reported", entry.Slug, mask, slot)
				}
			}
			tested++
		}
	}
	if tested != 272 {
		t.Fatalf("tested %d combinations, expected 272", tested)
	}
}

func TestContentPackSeedingFailureDoesNotLeavePartialImport(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	defer pool.Close()
	if err := db.AutoMigrate(&model.StudioTemplate{}); err != nil {
		t.Fatal(err)
	}
	attempt := 0
	if err := db.Callback().Create().Before("gorm:create").Register("test:pack-failure", func(tx *gorm.DB) {
		attempt++
		if attempt == 23 {
			tx.AddError(errors.New("simulated write failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := SeedContentPacks(db); err == nil {
		t.Fatal("expected import failure")
	}
	var count int64
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 0 {
		t.Fatal("partial content left after rollback", count)
	}
	db.Callback().Create().Remove("test:pack-failure")
	if err := SeedContentPacks(db); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 100 {
		t.Fatal("retry failed", count)
	}
}
