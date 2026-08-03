package admin

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestValidDefaultParams(t *testing.T) {
	ok := []string{"", `{}`, `{"aspectRatio":"16:9"}`, `{"duration":5,"resolution":"720P"}`}
	for _, v := range ok {
		if !validDefaultParams(v) {
			t.Errorf("validDefaultParams(%q) = false, want true", v)
		}
	}
	bad := []string{`[`, `[]`, `"x"`, `123`, `null`, `{"a":}`, `not json`}
	for _, v := range bad {
		if validDefaultParams(v) {
			t.Errorf("validDefaultParams(%q) = true, want false", v)
		}
	}
}

func TestValidateLegacyPresetSaveLimitsExecutablePrompt(t *testing.T) {
	dto := AdminSkillSaveDTO{OutputType: "image", PromptTemplate: strings.Repeat("a", maxSkillExecutablePromptBytes), DefaultParams: "{}"}
	if message := validateLegacyPresetSave(dto, true); message != "" {
		t.Fatalf("1 MiB prompt was rejected: %s", message)
	}
	dto.PromptTemplate += "a"
	if message := validateLegacyPresetSave(dto, true); message == "" {
		t.Fatal("prompt larger than 1 MiB was accepted")
	}
	if message := validateLegacyPresetSave(dto, false); message != "" {
		t.Fatalf("unchanged historical prompt was rejected: %s", message)
	}
}

func TestApplyAdminSkillGuidanceFieldsPreservesOmittedValues(t *testing.T) {
	fields := map[string]any{"title": "kept"}
	applyAdminSkillGuidanceFields(fields, AdminSkillSaveDTO{})
	if len(fields) != 1 || fields["title"] != "kept" {
		t.Fatalf("omitted guidance changed update fields: %#v", fields)
	}

	usage := "  商业短片  "
	howTo := "  输入主题  "
	output := "  输出分镜  "
	applyAdminSkillGuidanceFields(fields, AdminSkillSaveDTO{
		UsageScenario: &usage, HowTo: &howTo, OutputDescription: &output,
	})
	if fields["usage_scenario"] != "商业短片" || fields["how_to"] != "输入主题" || fields["output_description"] != "输出分镜" {
		t.Fatalf("guidance fields were not normalized: %#v", fields)
	}
}

func TestLegacyUpdateAllowsAdvancedPresetMetadataOnlyAndRejectsExecutionChange(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:legacy-update-guard?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{
		BaseModel: model.BaseModel{ID: idgen.ID(101)}, Title: "original", Description: "description",
		Category: "general", OutputType: "image", PromptTemplate: "cinematic", ModelID: "model-a",
		DefaultParams: "{}", AuthorName: "official", Status: 1, Kind: model.SkillKindPreset,
	}
	version := model.SkillVersion{
		BaseModel: model.BaseModel{ID: idgen.ID(102)}, SkillID: skill.ID, Version: 1,
		Kind: model.SkillKindPreset, Status: model.SkillVersionPublished,
		EntryPoints: `["chat","studio","canvas"]`, PrimaryOutputType: "image", OutputTypes: `["image"]`,
		InputSchema:    `{"type":"object"}`,
		ManifestJSON:   `{"kind":"preset","primaryOutputType":"image","outputTypes":["image"],"preferredNodeType":"character"}`,
		PromptTemplate: "cinematic", ModelID: "model-a", DefaultParams: "{}", PrimaryFilePath: "SKILL.md",
	}
	skill.CurrentVersionID = version.ID
	file := model.SkillFile{
		BaseModel: model.BaseModel{ID: idgen.ID(103)}, SkillVersionID: version.ID,
		Path: "SKILL.md", Content: "cinematic",
	}
	for _, row := range []any{&skill, &version, &file} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}

	callUpdate := func(dto AdminSkillSaveDTO) *httptest.ResponseRecorder {
		body, err := json.Marshal(dto)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPut, "/api/admin/skills/101", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		writer := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(writer)
		context.Request = request
		context.Params = gin.Params{{Key: "id", Value: skill.ID.String()}}
		(&skillsHandler{db: db}).update(context)
		return writer
	}

	usage := "new usage"
	metadataDTO := AdminSkillSaveDTO{
		Title: "metadata title", Description: skill.Description, Category: skill.Category,
		OutputType: skill.OutputType, PromptTemplate: skill.PromptTemplate, ModelID: skill.ModelID,
		DefaultParams: skill.DefaultParams, AuthorName: skill.AuthorName, UsageScenario: &usage,
	}
	if writer := callUpdate(metadataDTO); writer.Code != http.StatusOK {
		t.Fatalf("metadata-only update status = %d, body = %s", writer.Code, writer.Body.String())
	}
	var afterMetadata model.Skill
	if err := db.First(&afterMetadata, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterMetadata.Title != "metadata title" || afterMetadata.UsageScenario != usage || afterMetadata.CurrentVersionID != version.ID {
		t.Fatalf("metadata-only update produced unexpected skill: %#v", afterMetadata)
	}
	var versionCount int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", skill.ID).Count(&versionCount).Error; err != nil {
		t.Fatal(err)
	}
	if versionCount != 1 {
		t.Fatalf("metadata-only update created %d versions, want 1", versionCount)
	}

	blockedUsage := "must roll back"
	executionDTO := metadataDTO
	executionDTO.Title = "must roll back"
	executionDTO.UsageScenario = &blockedUsage
	executionDTO.PromptTemplate = "changed prompt"
	if writer := callUpdate(executionDTO); writer.Code != http.StatusBadRequest {
		t.Fatalf("advanced execution update status = %d, body = %s", writer.Code, writer.Body.String())
	}
	var afterBlocked model.Skill
	if err := db.First(&afterBlocked, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterBlocked.Title != "metadata title" || afterBlocked.UsageScenario != usage || afterBlocked.PromptTemplate != "cinematic" {
		t.Fatalf("blocked execution update was partially persisted: %#v", afterBlocked)
	}

	oversized := strings.Repeat("z", maxSkillExecutablePromptBytes+1)
	if err := db.Model(&model.Skill{}).Where("id = ?", skill.ID).Update("prompt_template", oversized).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SkillVersion{}).Where("id = ?", version.ID).Update("prompt_template", oversized).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", version.ID).Update("content", oversized).Error; err != nil {
		t.Fatal(err)
	}
	oversizedUsage := "metadata for historical oversized prompt"
	oversizedDTO := metadataDTO
	oversizedDTO.Title = "oversized metadata"
	oversizedDTO.PromptTemplate = oversized
	oversizedDTO.UsageScenario = &oversizedUsage
	if writer := callUpdate(oversizedDTO); writer.Code != http.StatusOK {
		t.Fatalf("metadata-only update for historical oversized prompt status = %d, body = %s", writer.Code, writer.Body.String())
	}
	var afterOversized model.Skill
	if err := db.First(&afterOversized, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterOversized.Title != "oversized metadata" || afterOversized.UsageScenario != oversizedUsage || afterOversized.PromptTemplate != oversized {
		t.Fatal("metadata-only update did not preserve historical oversized prompt")
	}
}
