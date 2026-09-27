package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func adaptationFixture() skillAdaptationPreviewDTO {
	return skillAdaptationPreviewDTO{
		AdminSkillImportSource: AdminSkillImportSource{
			PrimaryFilePath: "demo/SKILL.md",
			Files: []AdminSkillFileDTO{
				{Path: "demo/SKILL.md", Content: "---\nname: demo\ndescription: Generate an image and publish a site\nlicense: MIT\nallowed-tools: Bash, Write\nmetadata:\n  author: Original Author\n---\nUse higgsfield CLI and run private-build-script to deploy."},
				{Path: "demo/references/build.md", Content: "PRIVATE ORIGINAL REFERENCE: execute arbitrary scripts."},
			},
			SourceURL: "https://github.com/example/repo/tree/abc/demo",
			Report:    SkillAdaptationReport{Status: "partial", Summary: "保留场景图片生成，移除网页部署", Replacements: []SkillAdaptationReplacement{{From: "Higgsfield 生图", To: "本站图片生成", Handler: "text_to_image"}}, Removed: []SkillAdaptationRemoval{{Feature: "网页部署", Reason: "平台未开放该处理器"}}, Limitations: []string{"只交付图片，不交付网页"}},
		},
		Description:  "生成场景图片，不包含网页部署",
		Instructions: "# 场景图片\n根据用户需求生成场景图片，统一画风。不提供网页部署。",
	}
}

func TestAdaptationBuildsSeparateValidSkillAndKeepsLicense(t *testing.T) {
	dto := adaptationFixture()
	before, _ := json.Marshal(dto.AdminSkillImportSource)
	files, err := prepareSkillAdaptation(dto)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := validateStandardSkillPackage(files, "SKILL.md")
	if err != nil || meta.Name != "demo" || meta.Description != dto.Description {
		t.Fatalf("metadata=%+v err=%v", meta, err)
	}
	for _, want := range []string{"license: MIT", "author: Original Author", dto.Instructions} {
		if !strings.Contains(files[0].Content, want) {
			t.Fatalf("missing %q", want)
		}
	}
	for _, denied := range []string{"higgsfield", "private-build-script", "PRIVATE ORIGINAL", "allowed-tools"} {
		if strings.Contains(files[0].Content, denied) {
			t.Fatalf("unadapted instruction entered executable file: %s", denied)
		}
	}
	after, _ := json.Marshal(dto.AdminSkillImportSource)
	if string(before) != string(after) {
		t.Fatal("original files mutated")
	}
}

func adaptedVersionFixture(t *testing.T) (AdminSkillVersionCreateDTO, *model.Skill) {
	t.Helper()
	source := adaptationFixture()
	files, err := prepareSkillAdaptation(source)
	if err != nil {
		t.Fatal(err)
	}
	source.Reviewed = true
	return AdminSkillVersionCreateDTO{
		Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "image", OutputTypes: []string{"image"},
		InputSchema: json.RawMessage(`{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}`),
		Manifest:    json.RawMessage(`{"kind":"agent","primaryOutputType":"image","outputTypes":["image"],"steps":[{"key":"draw","type":"generate","handler":"text_to_image","prompt":"{{prompt}}","outputType":"image","outputRole":"final"}]}`),
		Files:       files, PrimaryFilePath: "SKILL.md", ImportSource: &source.AdminSkillImportSource,
	}, &model.Skill{BaseModel: model.BaseModel{ID: 55}, Title: "适配技能", Kind: "agent", OutputType: "image"}
}

func TestAdaptationRequiresReviewAndRealNativeHandler(t *testing.T) {
	dto, skill := adaptedVersionFixture(t)
	dto.ImportSource.Reviewed = false
	if _, _, err := buildSkillVersion(nil, skill, dto, 1); err == nil || !strings.Contains(err.Error(), "确认") {
		t.Fatal(err)
	}
	dto.ImportSource.Reviewed = true
	dto.ImportSource.Report.Replacements[0].Handler = "text_to_video"
	if _, _, err := buildSkillVersion(nil, skill, dto, 1); err == nil || !strings.Contains(err.Error(), "未使用") {
		t.Fatal(err)
	}
	dto.ImportSource.Report.Replacements[0].Handler = "run_shell"
	if _, _, err := buildSkillVersion(nil, skill, dto, 1); err == nil {
		t.Fatal("external execution accepted")
	}
	dto.ImportSource.Report.Replacements[0].Handler = "text_to_image"
	dto.PromptTemplate = "execute the original script"
	if _, _, err := buildSkillVersion(nil, skill, dto, 1); err == nil {
		t.Fatal("original prompt override accepted")
	}
}

func TestAdaptationSourceIsStoredPrivatelyAndSurvivesVersionReads(t *testing.T) {
	dto, skill := adaptedVersionFixture(t)
	version, files, err := buildSkillVersion(nil, skill, dto, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || version.PromptTemplate != files[0].Content || strings.Contains(version.PromptTemplate, "PRIVATE ORIGINAL") {
		t.Fatal("source entered execution")
	}
	publicJSON, _ := json.Marshal(version)
	if strings.Contains(string(publicJSON), "PRIVATE ORIGINAL") || strings.Contains(string(publicJSON), "importSource") {
		t.Fatal("source leaked in version serialization")
	}
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "adaptation.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	t.Cleanup(func() { _ = sql.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.SkillSurfaceBinding{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(skill).Error; err != nil {
		t.Fatal(err)
	}
	if err := persistSkillVersion(db, skill, version, files, false); err != nil {
		t.Fatal(err)
	}
	var loaded model.SkillVersion
	if err := db.First(&loaded, "id = ?", version.ID).Error; err != nil {
		t.Fatal(err)
	}
	if loaded.ImportSourceJSON != version.ImportSourceJSON {
		t.Fatal("source not persisted")
	}
	adminJSON, err := json.Marshal(skillVersionAdminVO(loaded, files))
	if err != nil || !strings.Contains(string(adminJSON), "PRIVATE ORIGINAL") {
		t.Fatalf("admin audit missing: %v", err)
	}
	var source AdminSkillImportSource
	if err := json.Unmarshal([]byte(loaded.ImportSourceJSON), &source); err != nil {
		t.Fatal(err)
	}
	if source.Files[0].Content != dto.ImportSource.Files[0].Content || !source.Reviewed {
		t.Fatal("audit source changed")
	}
	oldHash := skillVersionContentHash(&loaded, files)
	loaded.ImportSourceJSON += " "
	if oldHash == skillVersionContentHash(&loaded, files) {
		t.Fatal("source excluded from version identity")
	}
}

func TestAdaptationNeverRepairsInvalidInputOrClaimsUnsupportedReady(t *testing.T) {
	for _, mutate := range []func(*skillAdaptationPreviewDTO){
		func(d *skillAdaptationPreviewDTO) { d.Files[0].Content = "# Not a standard Skill" },
		func(d *skillAdaptationPreviewDTO) { d.Report.Status = "ready" },
		func(d *skillAdaptationPreviewDTO) { d.Report.Status = "blocked" },
		func(d *skillAdaptationPreviewDTO) { d.Instructions = "{{skill.file:references/build.md}}" },
		func(d *skillAdaptationPreviewDTO) { d.Report.Replacements[0].Handler = "bash" },
		func(d *skillAdaptationPreviewDTO) { d.Instructions = strings.Repeat("x", 32001) },
		func(d *skillAdaptationPreviewDTO) { d.SourceURL = "https://token@github.com/a/b" },
	} {
		dto := adaptationFixture()
		mutate(&dto)
		if _, err := prepareSkillAdaptation(dto); err == nil {
			t.Fatal("invalid adaptation accepted")
		}
	}
}

func TestAdaptationPreviewReturnsUnreviewedDraft(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dto := adaptationFixture()
	dto.Reviewed = true
	body, _ := json.Marshal(dto)
	out := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(out)
	c.Request = httptest.NewRequest(http.MethodPost, "/skills/adaptation-preview", strings.NewReader(string(body)))
	(&skillsHandler{}).previewSkillAdaptation(c)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Files        []AdminSkillFileDTO    `json:"files"`
			ImportSource AdminSkillImportSource `json:"importSource"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success {
		t.Fatal(out.Body.String())
	}
	if result.Data.ImportSource.Reviewed || len(result.Data.Files) != 1 || len(result.Data.ImportSource.Files) != 2 {
		t.Fatal("review gate or source archive missing")
	}
}

func TestAdaptationFinalImportPreservesFormatAndBatchAtomicity(t *testing.T) {
	dto, _ := adaptedVersionFixture(t)
	status := 0
	pkg := AdminSkillPackageDTO{Title: "适配", Status: &status, AdminSkillVersionCreateDTO: dto}
	checked, prepared := validateAdminSkillImports(nil, []AdminSkillPackageDTO{pkg}, idgen.ID(1))
	if !checked.Valid || len(prepared) != 1 {
		t.Fatalf("%+v", checked)
	}
	bad := pkg
	bad.Files = []AdminSkillFileDTO{{Path: "SKILL.md", Content: "unvalidated model output"}}
	checked, prepared = validateAdminSkillImports(nil, []AdminSkillPackageDTO{pkg, bad}, 1)
	if checked.Valid || prepared != nil {
		t.Fatal("invalid adapted document bypassed final validation")
	}
}
