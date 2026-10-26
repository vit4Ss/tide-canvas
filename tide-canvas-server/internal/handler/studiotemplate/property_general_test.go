package studiotemplate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
)

func TestPropertyPackPreservesThirtyScenesAndTwelveSourceStyles(t *testing.T) {
	entries, err := propertyGeneralEntries()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := contentPackFiles.ReadFile(propertyGeneralRoot + "source/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var source []struct {
		ID                                 int
		Category, Title, Style, Text, Path string
	}
	if err := json.Unmarshal(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf}), &source); err != nil || len(source) != 30 {
		t.Fatal(err)
	}
	raw, err = contentPackFiles.ReadFile(propertyGeneralRoot + "catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Styles  []struct{ ID, Name, Light, Camera, Sound string }
		Sources []struct{ SourceFile, SourceArchivePath, SourceSHA256 string }
	}
	if err := json.Unmarshal(raw, &catalog); err != nil || len(catalog.Styles) != 12 || len(catalog.Sources) != 5 {
		t.Fatal("missing styles or sources", err)
	}
	for _, file := range catalog.Sources {
		data, err := contentPackFiles.ReadFile(propertyGeneralRoot + file.SourceFile)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != file.SourceSHA256 {
			t.Fatal("source modified", file.SourceArchivePath)
		}
	}
	shots := regexp.MustCompile(`【镜(\d{2})｜(\d{2})—(\d{2})秒】`)
	actions := regexp.MustCompile(`主要动作：“([^”]+)”`)
	refs := regexp.MustCompile(`@图([0-9]+)`)
	unresolved := regexp.MustCompile(`\{(?:企业名|项目名|城市|入口|事实)\}`)
	voice := regexp.MustCompile(`“[^”]+”`)
	counts, styles := map[string]int{}, map[string]int{}
	combinations := 0
	for i, entry := range entries {
		original, tpl := source[i], entry.Template
		if original.ID != i+1 || entry.Slug != fmt.Sprintf("p%02d-30s", i+1) || tpl.Title != fmt.Sprintf("物业%02d %s · 30秒", i+1, original.Title) || tpl.Category != original.Category {
			t.Fatal("scene identity lost", entry.Slug)
		}
		counts[tpl.Category]++
		styleID := strings.Fields(original.Style)[0]
		styles[styleID]++
		styleIndex, err := strconv.Atoi(strings.TrimPrefix(styleID, "S"))
		if err != nil || styleIndex < 1 || styleIndex > len(catalog.Styles) {
			t.Fatal("invalid source style", original.Style)
		}
		style := catalog.Styles[styleIndex-1]
		if style.ID != styleID || style.ID+" "+style.Name != original.Style ||
			!strings.Contains(tpl.Prompt, style.Camera) || !strings.Contains(tpl.Prompt, style.Sound) ||
			(i != 19 && !strings.Contains(tpl.Prompt, style.Light)) {
			t.Fatal("source camera/light/sound style lost", entry.Slug)
		}
		voiceSection := strings.SplitN(strings.SplitN(original.Text, "【对白与声源】", 2)[1], "【音乐与拟音】", 2)[0]
		expectedVoice := voice.FindString(voiceSection)
		if i == 25 {
			expectedVoice = "“这里是我们的社区。从公共环境到日常沟通，我们用具体的服务，介绍这里的生活。”"
		}
		if i == 29 {
			expectedVoice = "“认真做事，也需要一起做事的人。了解岗位要求与实际安排，从认识日常工作开始。”"
		}
		if expectedVoice == "" || !strings.Contains(tpl.Prompt, expectedVoice) {
			t.Fatal("source narration lost", entry.Slug, expectedVoice)
		}
		if tpl.Kind != "inspiration" || tpl.MediaType != "video" || tpl.Status != 0 || tpl.Mode != "ref" || tpl.ModelKey != "" || tpl.CoverURL != "" || tpl.PreviewURL != "" {
			t.Fatal("unsafe publication/defaults", entry.Slug)
		}
		if tpl.Options.Duration != 30 || tpl.Options.AspectRatio != "9:16" || tpl.Options.Resolution != "720p" || tpl.Requirements.Images != 5 || !reflect.DeepEqual(tpl.Requirements.OptionalImages, []int{1, 3, 4, 5}) {
			t.Fatal("wrong settings", entry.Slug)
		}
		if len(tpl.InputLabels.Images) != 5 || !strings.HasPrefix(tpl.Prompt, "【生成视频：30秒｜9:16】") || !strings.Contains(tpl.Description, strings.TrimPrefix(original.Style, strings.Fields(original.Style)[0]+" ")) {
			t.Fatal("metadata mismatch", entry.Slug)
		}
		if !reflect.DeepEqual(shots.FindAllString(original.Text, -1), shots.FindAllString(tpl.Prompt, -1)) || len(shots.FindAllString(tpl.Prompt, -1)) != 15 {
			t.Fatal("timeline changed", entry.Slug)
		}
		for _, action := range actions.FindAllString(original.Text, -1) {
			if !strings.Contains(tpl.Prompt, action) {
				t.Fatal("original action lost", entry.Slug, action)
			}
		}
		for _, blocked := range []string{"【替换区】", "【随机换版入口】", "【随机风格选择器", "后期落版", "片尾落版", "后期覆盖", "最终直接给完整提示词"} {
			if strings.Contains(tpl.Prompt, blocked) {
				t.Fatal("authoring instructions remain", entry.Slug, blocked)
			}
		}
		if unresolved.MatchString(tpl.Prompt) || !strings.Contains(tpl.Prompt, "不自动套万科或其他品牌") || !strings.Contains(tpl.Prompt, "不伪装两秒修好") {
			t.Fatal("unbound field or lost source safeguard", entry.Slug)
		}
		if i == 19 && !strings.Contains(tpl.Prompt, "夜间保持自然低照度") {
			t.Fatal("night scene uses daylight")
		}
		if i == 29 && strings.Contains(tpl.Prompt, "已发布的岗位信息") {
			t.Fatal("unverified recruitment claim")
		}
		row := tpl.Row()
		if model.TemplatePromptMaxRunes(row) > 6000 {
			t.Fatal("expanded prompt exceeds 6000 characters", entry.Slug, model.TemplatePromptMaxRunes(row))
		}
		for mask := 0; mask < 16; mask++ {
			slots := []int{2}
			for j, n := range []int{1, 3, 4, 5} {
				if mask&(1<<j) != 0 {
					slots = append(slots, n)
				}
			}
			// Upload order follows the UI slot order, independently of omissions.
			slices.Sort(slots)
			prompt := model.ResolveTemplateImageReferences(row, slots)
			if strings.Contains(prompt, "{{image:") {
				t.Fatal("unresolved upload slot", entry.Slug)
			}
			for _, match := range refs.FindAllStringSubmatch(prompt, -1) {
				n, _ := strconv.Atoi(match[1])
				if n < 1 || n > len(slots) {
					t.Fatal("wrong upload reference", entry.Slug, slots, n)
				}
			}
			for j, n := range slots {
				if !strings.Contains(prompt, fmt.Sprintf("%s：@图%d", row.InputLabels.Images[n-1], j+1)) {
					t.Fatal("slot purpose shifted", entry.Slug, slots)
				}
			}
			for _, n := range []int{1, 3, 4, 5} {
				found := false
				for _, v := range slots {
					found = found || v == n
				}
				if !found && !strings.Contains(prompt, row.InputLabels.Images[n-1]+"：未上传") {
					t.Fatal("missing slot not explicit", entry.Slug, n)
				}
			}
			combinations++
		}
	}
	if !reflect.DeepEqual(counts, map[string]int{"日常服务": 5, "报修沟通": 5, "环境维护": 5, "秩序设施": 5, "邻里温度": 5, "项目宣传": 5}) || len(styles) != 12 || combinations != 480 {
		t.Fatal(counts, styles, combinations)
	}
}

func TestPropertyPackUpgradeIsPrivateIdempotentAndPreservesCuration(t *testing.T) {
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
	// Simulate the deployed 70-template version, including an operator edit.
	for _, pack := range []struct {
		prefix string
		load   func() ([]contentPackEntry, error)
	}{{StoreFoodSourcePrefix, storeFoodEntries}, {GroupbuyPromoSourcePrefix, groupbuyPromoEntries}} {
		entries, err := pack.load()
		if err != nil {
			t.Fatal(err)
		}
		for i, entry := range entries {
			row := entry.Template.Row()
			key := pack.prefix + entry.Slug
			row.SourceKey = &key
			if i == 0 {
				row.Title = "旧版运营标题"
				row.CoverURL = "https://fixture.test/curated.png"
				row.Status = 1
				row.ModelKey = "operator-model"
				row.Options.Resolution = "1080p"
			}
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	created := 0
	if err := db.Callback().Create().Before("gorm:create").Register("test:property-upgrade-failure", func(tx *gorm.DB) {
		if row, ok := tx.Statement.Dest.(*model.StudioTemplate); ok && row.SourceKey != nil && strings.HasPrefix(*row.SourceKey, PropertyGeneralSourcePrefix) {
			created++
			if created == 4 {
				tx.AddError(errors.New("simulated new-pack failure"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := SeedContentPacks(db); err == nil {
		t.Fatal("failure was ignored")
	}
	var count int64
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 70 {
		t.Fatal("partial new pack persisted", count)
	}
	db.Callback().Create().Remove("test:property-upgrade-failure")
	for range 2 {
		if err := SeedContentPacks(db); err != nil {
			t.Fatal(err)
		}
	}
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 100 {
		t.Fatal("upgrade duplicated or lost templates", count)
	}
	var old model.StudioTemplate
	db.Where("source_key = ?", GroupbuyPromoSourcePrefix+"f01-30s").First(&old)
	if old.Title != "旧版运营标题" || old.Status != 1 || old.ModelKey != "operator-model" || old.Options.Resolution != "1080p" || old.CoverURL != "https://fixture.test/curated.png" {
		t.Fatal("old curation overwritten")
	}
	r := gin.New()
	h := &Handler{DB: db}
	r.GET("/admin", h.List(true))
	r.GET("/public", h.List(false))
	for _, query := range []string{"/admin?keyword=物业01&status=0", "/public?category=日常服务"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", query, nil))
		var result struct {
			Success bool
			Data    struct{ Total int }
		}
		want := 1
		if strings.HasPrefix(query, "/public") {
			want = 0
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Success || result.Data.Total != want {
			t.Fatal(query, w.Body.String(), err)
		}
	}
	var edited, deleted model.StudioTemplate
	db.Where("source_key = ?", PropertyGeneralSourcePrefix+"p01-30s").First(&edited)
	db.Where("source_key = ?", PropertyGeneralSourcePrefix+"p30-30s").First(&deleted)
	if err := db.Model(&edited).Updates(map[string]any{"title": "新批运营标题", "prompt": "私有运营配方", "status": 1, "uses": 12}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedContentPacks(db); err != nil {
		t.Fatal(err)
	}
	db.First(&edited, "id = ?", edited.ID)
	if edited.Title != "新批运营标题" || edited.Prompt != "私有运营配方" || edited.Status != 1 || edited.Uses != 12 {
		t.Fatal("new curation overwritten")
	}
	db.Model(&model.StudioTemplate{}).Count(&count)
	if count != 99 {
		t.Fatal("deleted template returned", count)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/public?category=日常服务", nil))
	if strings.Contains(w.Body.String(), "私有运营配方") || strings.Contains(w.Body.String(), "sourceKey") {
		t.Fatal("private material leaked", w.Body.String())
	}
}
