package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
)

func exposureTestServer(t *testing.T) (*gorm.DB, *gin.Engine) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.Skill{BaseModel: model.BaseModel{ID: 101}, Title: "review", Kind: "agent", Status: 1, CurrentVersionID: 201, PromptTemplate: "private prompt", ModelID: "private-model", DefaultParams: `{"private":true}`, SortOrder: 3, UseCount: 9},
		&model.SkillVersion{BaseModel: model.BaseModel{ID: 201}, SkillID: 101, Version: 1, Status: model.SkillVersionPublished, PrimaryFilePath: "SKILL.md"},
		&model.SkillFile{BaseModel: model.BaseModel{ID: 301}, SkillVersionID: 201, Path: "SKILL.md", Content: standardSkillText("review")},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterSkills(router.Group("/api/admin"), &app.Deps{DB: db})
	return db, router
}

func exposureRequest(router *gin.Engine, id, body string) *httptest.ResponseRecorder {
	out := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/api/admin/skills/"+id+"/exposure", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(out, req)
	return out
}

func TestExposureDefaultsOffAndOnlyChangesPublicFlag(t *testing.T) {
	db, router := exposureTestServer(t)
	var original model.Skill
	if err := db.First(&original, "id = ?", 101).Error; err != nil || original.MCPEnabled {
		t.Fatalf("new skills must default to private: %+v %v", original, err)
	}
	for _, enabled := range []bool{true, true, false, false} {
		body, _ := json.Marshal(map[string]any{"enabled": enabled, "title": "must not overwrite", "status": 0, "promptTemplate": "must not overwrite"})
		out := exposureRequest(router, "101", string(body))
		if out.Code != 200 || strings.Contains(out.Body.String(), "private") || !strings.Contains(out.Body.String(), `"id":"101"`) {
			t.Fatalf("toggle failed or disclosed private source: %s", out.Body.String())
		}
		var actual model.Skill
		if err := db.First(&actual, "id = ?", 101).Error; err != nil {
			t.Fatal(err)
		}
		if actual.MCPEnabled != enabled || actual.Title != original.Title || actual.Status != original.Status || actual.CurrentVersionID != original.CurrentVersionID || actual.PromptTemplate != original.PromptTemplate || actual.ModelID != original.ModelID || actual.DefaultParams != original.DefaultParams || actual.SortOrder != original.SortOrder || actual.UseCount != original.UseCount {
			t.Fatalf("exposure toggle changed unrelated skill fields: %+v", actual)
		}
	}
	var count int64
	if err := db.Model(&model.SkillVersion{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("toggle created a new execution version")
	}
	for _, body := range []string{`{}`, `{"enabled":null}`, `{"enabled":"false"}`, `{"enabled":1}`} {
		if out := exposureRequest(router, "101", body); out.Code != 400 {
			t.Fatalf("invalid toggle accepted: %s %s", body, out.Body.String())
		}
	}
	if out := exposureRequest(router, "999", `{"enabled":false}`); out.Code != 404 {
		t.Fatalf("missing skill: %s", out.Body.String())
	}
}

func TestExposureRequiresValidPublishedOwnVersionButCanAlwaysDisable(t *testing.T) {
	cases := map[string]func(*gorm.DB) error{
		"invalid document": func(db *gorm.DB) error {
			return db.Model(&model.SkillFile{}).Where("id = ?", 301).Update("content", "not a Skill").Error
		},
		"missing primary file": func(db *gorm.DB) error { return db.Delete(&model.SkillFile{}, "id = ?", 301).Error },
		"draft version": func(db *gorm.DB) error {
			return db.Model(&model.SkillVersion{}).Where("id = ?", 201).Update("status", model.SkillVersionDraft).Error
		},
		"other skill version": func(db *gorm.DB) error {
			return db.Model(&model.SkillVersion{}).Where("id = ?", 201).Update("skill_id", 999).Error
		},
		"missing version": func(db *gorm.DB) error { return db.Delete(&model.SkillVersion{}, "id = ?", 201).Error },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			db, router := exposureTestServer(t)
			if err := mutate(db); err != nil {
				t.Fatal(err)
			}
			if out := exposureRequest(router, "101", `{"enabled":true}`); out.Code != 400 {
				t.Fatalf("invalid package exposed: %s", out.Body.String())
			}
			var rejected model.Skill
			if err := db.First(&rejected, "id = ?", 101).Error; err != nil || rejected.MCPEnabled {
				t.Fatal("failed validation still enabled exposure")
			}
			if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("mcp_enabled", true).Error; err != nil {
				t.Fatal(err)
			}
			if out := exposureRequest(router, "101", `{"enabled":false}`); out.Code != 200 {
				t.Fatalf("could not disable invalid historical Skill: %s", out.Body.String())
			}
			if err := db.First(&rejected, "id = ?", 101).Error; err != nil || rejected.MCPEnabled {
				t.Fatal("disable was not persisted")
			}
		})
	}
}

func TestExposureDoesNotPublishAnOfflineSkill(t *testing.T) {
	db, router := exposureTestServer(t)
	if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if out := exposureRequest(router, "101", `{"enabled":true}`); out.Code != 200 {
		t.Fatalf("could not prepare exposure while offline: %s", out.Body.String())
	}
	var actual model.Skill
	if err := db.First(&actual, "id = ?", 101).Error; err != nil || !actual.MCPEnabled || actual.Status != 0 {
		t.Fatal("exposure silently published an offline Skill")
	}
}

func TestInvalidExposedSkillCanBeTakenOfflineWithoutRevalidating(t *testing.T) {
	db, router := exposureTestServer(t)
	if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("mcp_enabled", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SkillFile{}).Where("id = ?", 301).Update("content", "invalid historical package").Error; err != nil {
		t.Fatal(err)
	}
	update := func(status int, exposure *bool) *httptest.ResponseRecorder {
		body, _ := json.Marshal(AdminSkillSaveDTO{Title: "review", Status: &status, MCPEnabled: exposure})
		out := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/api/admin/skills/101", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(out, req)
		return out
	}
	if out := update(0, nil); out.Code != 200 {
		t.Fatalf("invalid Skill could not be taken offline: %s", out.Body.String())
	}
	if out := update(1, nil); out.Code != 400 {
		t.Fatalf("invalid exposed Skill could be published again: %s", out.Body.String())
	}
	enabled := true
	if out := update(0, &enabled); out.Code != 400 {
		t.Fatalf("explicit offline opt-in bypassed format validation: %s", out.Body.String())
	}
	if out := exposureRequest(router, "101", `{"enabled":false}`); out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	if out := update(1, nil); out.Code != 200 {
		t.Fatalf("existing native-only Skill was affected: %s", out.Body.String())
	}
	var current model.Skill
	if err := db.First(&current, "id = ?", 101).Error; err != nil || current.MCPEnabled || current.Status != 1 {
		t.Fatal("omitted exposure flag restored an earlier setting")
	}
}

func TestSkillUsageExamplesCanBeEditedWithoutChangingExecution(t *testing.T) {
	db, router := exposureTestServer(t)
	put := func(body string) *httptest.ResponseRecorder {
		out := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/api/admin/skills/101", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(out, req)
		return out
	}
	if out := put(`{"title":"review","inputDescription":"  上传视频并说明关注点  ","inputExample":"  帮我检查人物一致性  ","outputExample":"  ## 审查结果\n- 修改动作衔接  "}`); out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	// Legacy status/metadata saves omit the new fields and must preserve them.
	if out := put(`{"title":"renamed","status":0}`); out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	var row model.Skill
	if err := db.First(&row, "id = ?", 101).Error; err != nil {
		t.Fatal(err)
	}
	if row.InputDescription != "上传视频并说明关注点" || row.InputExample != "帮我检查人物一致性" || row.OutputExample != "## 审查结果\n- 修改动作衔接" || row.CurrentVersionID != 201 || row.PromptTemplate != "private prompt" || row.ModelID != "private-model" {
		t.Fatalf("guidance edit changed or lost data: %+v", row)
	}
	for field, max := range map[string]int{"inputDescription": 2000, "inputExample": 4000, "outputExample": 6000} {
		body, _ := json.Marshal(map[string]any{"title": "must not save", field: strings.Repeat("字", max+1)})
		if out := put(string(body)); out.Code != 400 {
			t.Fatalf("oversized %s accepted: %s", field, out.Body.String())
		}
	}
	if out := put(`{"title":"renamed","inputDescription":"","inputExample":"","outputExample":""}`); out.Code != 200 {
		t.Fatal(out.Body.String())
	}
	if err := db.First(&row, "id = ?", 101).Error; err != nil || row.InputDescription != "" || row.InputExample != "" || row.OutputExample != "" {
		t.Fatal("explicit clearing failed")
	}
	var count int64
	if err := db.Model(&model.SkillVersion{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("guide edits created execution versions")
	}
}
