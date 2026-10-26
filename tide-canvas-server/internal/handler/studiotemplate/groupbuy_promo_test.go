package studiotemplate

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"reflect"
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

func TestGroupbuyPackKeepsAllFiftySourcesAndDirectVideoRecipes(t *testing.T) {
	entries, err := groupbuyPromoEntries()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := contentPackFiles.ReadFile(groupbuyPromoRoot + "source/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var original struct {
		Cards []struct {
			ID, Category, Name, Guard string
			Beats                     []string
		}
	}
	if err := json.Unmarshal(raw, &original); err != nil || len(original.Cards) != 50 {
		t.Fatalf("invalid original manifest: %v", err)
	}
	counts := map[string]int{}
	for i, entry := range entries {
		tpl, source := entry.Template, original.Cards[i]
		counts[tpl.Category]++
		if entry.Slug != strings.ToLower(source.ID)+"-30s" || tpl.Category != source.Category || !strings.Contains(tpl.Title, source.Name) {
			t.Fatal("source identity changed", entry.Slug)
		}
		if tpl.Kind != "inspiration" || tpl.MediaType != "video" || tpl.Mode != "ref" || tpl.Status != 0 || tpl.ModelKey != "" || tpl.CoverURL != "" || tpl.PreviewURL != "" {
			t.Fatal("draft has unverified publication/model/media", entry.Slug)
		}
		if tpl.Options.Duration != 30 || tpl.Options.AspectRatio != "9:16" || tpl.Requirements.Images != 5 || len(tpl.InputLabels.Images) != 5 || !reflect.DeepEqual(tpl.Requirements.OptionalImages, []int{1, 3, 4, 5}) {
			t.Fatal("wrong duration or slot contract", entry.Slug)
		}
		guard := strings.ReplaceAll(source.Guard, "未确认活动只写方案", "未确认活动时只拍概念活动示意，不声称已经举办")
		if utf8.RuneCountInString(tpl.Prompt) > 20000 || !strings.Contains(tpl.Prompt, guard) || !strings.Contains(tpl.Prompt, "无价格概念宣传版") {
			t.Fatal("prompt limit or source safeguards lost", entry.Slug)
		}
		for _, blocked := range []string{"【客户填写区", "【输出格式", "输出可直接提交视频生成模型", "{价格句}", "@图", "后期叠加", "只写方案", "仅有图片时"} {
			if strings.Contains(tpl.Prompt, blocked) {
				t.Fatal("authoring-only instruction or raw reference left", entry.Slug, blocked)
			}
		}
		if !strings.Contains(tpl.Prompt, "不因资料是图片而忽略") {
			t.Fatal("uploaded pricing evidence ignored", entry.Slug)
		}
		for n, beat := range source.Beats {
			if !strings.Contains(tpl.Prompt, fmt.Sprintf("第%02d镜｜%02d—%02d秒｜%s", n+1, n*2, (n+1)*2, beat)) {
				t.Fatal("original shot order lost", entry.Slug, beat)
			}
		}
	}
	if !reflect.DeepEqual(counts, map[string]int{"美食团购": 12, "景区团购": 12, "美业团购": 10, "企业宣传": 6, "店铺宣传": 6, "万科物业专项": 4}) {
		t.Fatal("category distribution changed", counts)
	}
	raw, err = contentPackFiles.ReadFile(groupbuyPromoRoot + "catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct{ Sources []contentPackEntry }
	if err := json.Unmarshal(raw, &catalog); err != nil || len(catalog.Sources) != 5 {
		t.Fatal("source documents missing", err)
	}
	for _, source := range catalog.Sources {
		b, err := contentPackFiles.ReadFile(groupbuyPromoRoot + source.SourceFile)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != source.SourceSHA256 {
			t.Fatal("source was changed", source.SourceFile)
		}
	}
}

func TestGroupbuyPackAllOptionalImagesRemainBoundToTheirRoles(t *testing.T) {
	entries, err := groupbuyPromoEntries()
	if err != nil {
		t.Fatal(err)
	}
	refs := regexp.MustCompile("@图([0-9]+)")
	tested := 0
	for _, entry := range entries {
		row := entry.Template.Row()
		for mask := 0; mask < 16; mask++ {
			slots := []int{}
			for slot := 1; slot <= 5; slot++ {
				present := slot == 2
				for i, optional := range row.Requirements.OptionalImages {
					present = present || optional == slot && mask&(1<<i) != 0
				}
				if present {
					slots = append(slots, slot)
				}
			}
			prompt := model.ResolveTemplateImageReferences(row, slots)
			if strings.Contains(prompt, "{{image:") || utf8.RuneCountInString(prompt) > model.TemplatePromptMaxRunes(row) {
				t.Fatal("unresolved reference or underestimated prompt size", entry.Slug, slots)
			}
			for _, match := range refs.FindAllStringSubmatch(prompt, -1) {
				n, _ := strconv.Atoi(match[1])
				if n < 1 || n > len(slots) {
					t.Fatal("reference exceeds actual uploads", entry.Slug, slots)
				}
			}
			for i, slot := range slots {
				if !strings.Contains(prompt, fmt.Sprintf("%s：@图%d（", row.InputLabels.Images[slot-1], i+1)) {
					t.Fatal("slot role shifted", entry.Slug, slots)
				}
			}
			for i, slot := range row.Requirements.OptionalImages {
				if mask&(1<<i) == 0 && !strings.Contains(prompt, row.InputLabels.Images[slot-1]+"：未上传") {
					t.Fatal("absent input was not declared", entry.Slug, slots)
				}
			}
			tested++
		}
	}
	if tested != 800 {
		t.Fatal("missing optional combinations", tested)
	}
}

func TestGroupbuyPackUpgradePreservesExistingAndOperatorChanges(t *testing.T) {
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
	// Simulate a deployed previous version, including an already edited recipe.
	old, err := storeFoodEntries()
	if err != nil {
		t.Fatal(err)
	}
	for i, entry := range old {
		row := entry.Template.Row()
		key := StoreFoodSourcePrefix + entry.Slug
		row.SourceKey = &key
		if i == 0 {
			row.Title = "已经运营的模板"
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	// A failure while upgrading must preserve all existing rows and roll back
	// only the new inserts; a later restart can then finish the entire pack.
	attempt := 0
	if err := db.Callback().Create().Before("gorm:create").Register("test:upgrade-failure", func(tx *gorm.DB) {
		attempt++
		if attempt == 3 {
			tx.AddError(errors.New("simulated upgrade failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := SeedContentPacks(db); err == nil {
		t.Fatal("expected upgrade failure")
	}
	var count int64
	if err := db.Unscoped().Model(&model.StudioTemplate{}).Count(&count).Error; err != nil || count != 20 {
		t.Fatal("failed upgrade left partial inserts or lost old rows", count, err)
	}
	if err := db.Callback().Create().Remove("test:upgrade-failure"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := SeedContentPacks(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Unscoped().Model(&model.StudioTemplate{}).Count(&count).Error; err != nil || count != 100 {
		t.Fatalf("upgrade imported duplicates or lost data: %d %v", count, err)
	}
	var existing model.StudioTemplate
	if err := db.Where("source_key = ?", StoreFoodSourcePrefix+old[0].Slug).First(&existing).Error; err != nil || existing.Title != "已经运营的模板" {
		t.Fatal("previous pack was overwritten", err)
	}
	r := gin.New()
	r.GET("/admin", (&Handler{DB: db}).List(true))
	r.GET("/public", (&Handler{DB: db}).List(false))
	for _, tc := range []struct {
		query string
		count int
	}{{"/admin?mediaType=video&kind=inspiration&status=0&keyword=F01", 1}, {"/admin?category=景区团购&status=0", 12}, {"/public", 0}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", tc.query, nil))
		var result struct {
			Success bool
			Data    struct{ Total int }
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Success || result.Data.Total != tc.count {
			t.Fatal(tc.query, w.Body.String())
		}
	}
	var changed, deleted model.StudioTemplate
	if err := db.Where("source_key = ?", GroupbuyPromoSourcePrefix+"f01-30s").First(&changed).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("source_key = ?", GroupbuyPromoSourcePrefix+"w04-30s").First(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&changed).Updates(map[string]any{"title": "运营修改", "prompt": "运营配方", "status": 1, "model_key": "chosen-model", "uses": 9}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedContentPacks(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&changed, "id = ?", changed.ID).Error; err != nil || changed.Title != "运营修改" || changed.Prompt != "运营配方" || changed.Status != 1 || changed.ModelKey != "chosen-model" || changed.Uses != 9 {
		t.Fatal("restart overwrote new pack curation", err)
	}
	if err := db.Model(&model.StudioTemplate{}).Count(&count).Error; err != nil || count != 99 {
		t.Fatal("deleted content resurrected", count, err)
	}
}
