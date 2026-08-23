package skill

import (
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func TestBaselineToolSkillsAreCompleteAndValidJSON(t *testing.T) {
	if len(baselineToolSkills) != 7 {
		t.Fatalf("tool seed count = %d, want 7", len(baselineToolSkills))
	}
	seen := map[string]bool{}
	for _, definition := range baselineToolSkills {
		if definition.key == "" || definition.title == "" || seen[definition.key] {
			t.Fatalf("invalid or duplicate tool seed: %#v", definition)
		}
		seen[definition.key] = true
		for label, raw := range map[string]string{"inputSchema": definition.inputSchema, "manifest": definition.manifest} {
			var value map[string]any
			if json.Unmarshal([]byte(raw), &value) != nil || value == nil {
				t.Fatalf("%s %s is not a JSON object", definition.key, label)
			}
		}
		if definition.defaultParams != "" {
			var defaults map[string]any
			if json.Unmarshal([]byte(definition.defaultParams), &defaults) != nil || defaults == nil {
				t.Fatalf("%s defaultParams is not a JSON object", definition.key)
			}
		}
		var manifest struct {
			Kind  string `json:"kind"`
			Steps []struct {
				Type    string `json:"type"`
				Handler string `json:"handler"`
			} `json:"steps"`
		}
		if err := json.Unmarshal([]byte(definition.manifest), &manifest); err != nil {
			t.Fatal(err)
		}
		if manifest.Kind != "tool" || len(manifest.Steps) == 0 {
			t.Fatalf("%s has no tool manifest steps", definition.key)
		}
		toolSteps := 0
		for _, step := range manifest.Steps {
			if step.Type == "tool" && step.Handler != "" {
				toolSteps++
			}
		}
		if toolSteps == 0 {
			t.Fatalf("%s has no registered tool step", definition.key)
		}
	}
}

func TestEnsureBaselineToolSkillsRepairsLegacyPresetBackfill(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "cgo") {
			t.Skip("sqlite driver requires CGO in this environment")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.SkillSurfaceBinding{}); err != nil {
		t.Fatal(err)
	}
	legacy := model.Skill{
		Title: "生成 PPT", Description: "legacy", Category: "办公文档", OutputType: "file",
		PromptTemplate: "legacy", DefaultParams: "{}", AuthorName: "官方",
		SeedKey: "tool-pptx", Status: 1, Kind: model.SkillKindPreset,
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	legacyVersion := model.SkillVersion{
		SkillID: legacy.ID, Version: 1, Kind: model.SkillKindPreset, Status: model.SkillVersionPublished,
		EntryPoints: "[\"chat\",\"studio\",\"canvas\"]", PrimaryOutputType: "file",
		OutputTypes: "[\"file\"]", InputSchema: "{\"type\":\"object\"}",
		BindingsJSON:   "[{\"surface\":\"studio\",\"targetType\":\"*\",\"enabled\":true}]",
		PromptTemplate: "legacy", DefaultParams: "{}", PrimaryFilePath: "SKILL.md",
	}
	if err := db.Create(&legacyVersion).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", legacy.ID).
		Update("current_version_id", legacyVersion.ID).Error; err != nil {
		t.Fatal(err)
	}

	if err := ensureBaselineToolSkills(db); err != nil {
		t.Fatal(err)
	}
	var repaired model.Skill
	if err := db.First(&repaired, "id = ?", legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if repaired.Kind != model.SkillKindTool || repaired.CurrentVersionID == legacyVersion.ID {
		t.Fatalf("legacy tool was not repaired: kind=%q current=%s", repaired.Kind, repaired.CurrentVersionID.String())
	}
	var current model.SkillVersion
	if err := db.First(&current, "id = ?", repaired.CurrentVersionID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Kind != model.SkillKindTool || current.Status != model.SkillVersionPublished ||
		!strings.Contains(current.InputSchema, "\"x-asset-types\"") {
		t.Fatalf("repaired version is invalid: %#v", current)
	}
	var binding model.SkillSurfaceBinding
	if err := db.Where("skill_id = ? AND surface = ? AND target_type = ?", repaired.ID, "studio", "*").
		First(&binding).Error; err != nil {
		t.Fatal(err)
	}
	if !binding.Enabled {
		t.Fatal("repaired tool studio binding is disabled")
	}
	var visible int64
	if err := applySurfaceFilter(
		db.Model(&model.Skill{}).Where("skill.id = ? AND skill.status = 1 AND skill.kind = ?", repaired.ID, model.SkillKindTool),
		"studio", "",
	).Count(&visible).Error; err != nil {
		t.Fatal(err)
	}
	if visible != 1 {
		t.Fatalf("repaired official tool is still absent from the studio catalog: %d", visible)
	}
}

func TestPublicInputSchemaKeepsReservedRequirements(t *testing.T) {
	raw := `{"type":"object","x-asset-types":["video"],"required":["prompt","assets","focus"],"properties":{"prompt":{"type":"string"},"assets":{"type":"array"},"focus":{"type":"string"}}}`
	var schema map[string]any
	if err := json.Unmarshal(publicInputSchema(raw), &schema); err != nil {
		t.Fatal(err)
	}
	properties, _ := schema["properties"].(map[string]any)
	if _, exists := properties["prompt"]; exists {
		t.Fatal("reserved prompt definition leaked")
	}
	if _, exists := properties["assets"]; exists {
		t.Fatal("reserved assets definition leaked")
	}
	required, _ := schema["required"].([]any)
	if len(required) != 3 {
		t.Fatalf("reserved requirements were removed: %#v", required)
	}
}

func TestPPTSeedUsesCommercialNarrativeSchemaV3(t *testing.T) {
	if baselineToolVersion("tool-pptx") != 3 {
		t.Fatal("PPT seed must upgrade untouched official v1/v2 snapshots")
	}
	var ppt seedToolSkill
	for _, definition := range baselineToolSkills {
		if definition.key == "tool-pptx" {
			ppt = definition
			break
		}
	}
	for _, required := range []string{"imageIndexes", "metrics", "comparison", "timeline", "closing", "参考图", "polish", "AUTO", "智能匹配"} {
		if !strings.Contains(ppt.manifest, required) {
			t.Fatalf("PPT commercial prompt is missing %q", required)
		}
	}
}

func TestOtherToolSeedsUseReviewedV2Workflows(t *testing.T) {
	for _, definition := range baselineToolSkills {
		if definition.key == "tool-pptx" {
			continue
		}
		if baselineToolVersion(definition.key) != 2 {
			t.Fatalf("%s must publish the reviewed v2 workflow", definition.key)
		}
	}
	checks := map[string][]string{
		"tool-xlsx":           {"audit", "formula", "freezeRows", "autoFilter"},
		"tool-docx":           {"edit", "numbered", "callout", "table"},
		"tool-markdown":       {"edit", "标题层级", "代码围栏"},
		"tool-video-analysis": {"analyze_video"},
		"tool-audio-analysis": {"analyze_audio"},
		"tool-web-analysis":   {"analyze_webpage"},
	}
	for _, definition := range baselineToolSkills {
		for _, required := range checks[definition.key] {
			if !strings.Contains(definition.manifest+definition.instructions, required) {
				t.Fatalf("%s v2 workflow is missing %q", definition.key, required)
			}
		}
	}
}
