package admin

import (
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestValidateAdminSkillPackageMetadata(t *testing.T) {
	status := 1
	pkg := AdminSkillPackageDTO{
		Title: "skill", Description: strings.Repeat("d", 255), CoverURL: strings.Repeat("c", 512),
		Category: strings.Repeat("x", 32), AuthorName: strings.Repeat("a", 64),
		UsageScenario: strings.Repeat("u", 2000), HowTo: strings.Repeat("h", 2000),
		OutputDescription: strings.Repeat("o", 2000), Status: &status,
	}
	if err := validateAdminSkillPackageMetadata(pkg); err != nil {
		t.Fatalf("boundary metadata was rejected: %v", err)
	}

	invalidStatus := 2
	cases := []AdminSkillPackageDTO{
		{Title: ""},
		{Title: strings.Repeat("t", 65)},
		{Title: "skill", Description: strings.Repeat("d", 256)},
		{Title: "skill", CoverURL: strings.Repeat("c", 513)},
		{Title: "skill", Category: strings.Repeat("c", 33)},
		{Title: "skill", AuthorName: strings.Repeat("a", 65)},
		{Title: "skill", UsageScenario: strings.Repeat("u", 2001)},
		{Title: "skill", HowTo: strings.Repeat("h", 2001)},
		{Title: "skill", OutputDescription: strings.Repeat("o", 2001)},
		{Title: "skill", Status: &invalidStatus},
	}
	for index, item := range cases {
		if err := validateAdminSkillPackageMetadata(item); err == nil {
			t.Fatalf("invalid metadata case %d was accepted", index)
		}
	}
}

func TestBuildSkillVersionLimitsExecutablePromptAndPrimaryFile(t *testing.T) {
	skill := &model.Skill{OutputType: "image"}
	atLimit := strings.Repeat("a", maxSkillExecutablePromptBytes)
	if err := validateSkillExecutablePromptSize(atLimit, "SKILL.md", []model.SkillFile{{Path: "SKILL.md", Content: atLimit}}); err != nil {
		t.Fatalf("executable prompt at the limit was rejected: %v", err)
	}
	if err := validateSkillExecutablePromptSize(atLimit+"a", "SKILL.md", []model.SkillFile{{Path: "SKILL.md", Content: atLimit}}); err == nil {
		t.Fatal("published prompt over the limit was accepted")
	}
	if err := validateSkillExecutablePromptSize(atLimit, "SKILL.md", []model.SkillFile{{Path: "SKILL.md", Content: atLimit + "a"}}); err == nil {
		t.Fatal("published primary skill file over the limit was accepted")
	}

	oversized := strings.Repeat("a", maxSkillExecutablePromptBytes+1)
	_, _, err := buildSkillVersion(nil, skill, AdminSkillVersionCreateDTO{
		Kind: model.SkillKindPreset, PrimaryOutputType: "image", PromptTemplate: oversized,
	}, 0)
	if err == nil {
		t.Fatal("oversized promptTemplate was accepted")
	}

	_, _, err = buildSkillVersion(nil, skill, AdminSkillVersionCreateDTO{
		Kind: model.SkillKindPreset, PrimaryOutputType: "image", PromptTemplate: "wrapper",
		PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: oversized}},
	}, 0)
	if err == nil {
		t.Fatal("oversized primary skill file was accepted")
	}
}

func TestBuildSkillVersionEnforcesTwoKindContracts(t *testing.T) {
	skill := &model.Skill{OutputType: "image"}
	base := AdminSkillVersionCreateDTO{Kind: model.SkillKindPreset, PrimaryOutputType: "image", PromptTemplate: "instructions"}
	if _, _, err := buildSkillVersion(nil, skill, base, 0); err != nil {
		t.Fatalf("valid preset was rejected: %v", err)
	}

	invalid := []AdminSkillVersionCreateDTO{
		{Kind: "workflow", PrimaryOutputType: "image", PromptTemplate: "instructions"},
		{Kind: model.SkillKindPreset, PrimaryOutputType: "image", OutputTypes: []string{"image", "video"}, PromptTemplate: "instructions"},
		{Kind: model.SkillKindPreset, EntryPoints: []string{"api"}, PrimaryOutputType: "image", PromptTemplate: "instructions"},
		{Kind: model.SkillKindPreset, PrimaryOutputType: "image", PromptTemplate: "instructions",
			Bindings: []AdminSkillBindingDTO{{Surface: "asset", TargetType: "*"}}},
		{Kind: model.SkillKindAgent, EntryPoints: []string{"studio"}, PrimaryOutputType: "image", PromptTemplate: "instructions"},
		{Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"}, PrimaryOutputType: "image", PromptTemplate: "instructions",
			Bindings: []AdminSkillBindingDTO{{Surface: "chat", TargetType: "*"}}},
		{Kind: model.SkillKindPreset, PrimaryOutputType: "image", PromptTemplate: "instructions",
			Manifest: json.RawMessage(`{"kind":"preset","steps":[{"type":"generate","outputType":"image","outputRole":"final"}]}`)},
	}
	for index, dto := range invalid {
		if _, _, err := buildSkillVersion(nil, skill, dto, 0); err == nil {
			t.Fatalf("invalid kind contract case %d was accepted", index)
		}
	}

	agent := AdminSkillVersionCreateDTO{
		Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
		PrimaryOutputType: "video", OutputTypes: []string{"image", "video"}, PromptTemplate: "instructions",
		Manifest: json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"image","outputRole":"intermediate"},{"type":"generate","outputType":"video","outputRole":"final"}]}`),
		Bindings: []AdminSkillBindingDTO{{Surface: "canvas", TargetType: "*"}},
	}
	version, _, err := buildSkillVersion(nil, skill, agent, 0)
	if err != nil {
		t.Fatalf("valid multi-output canvas agent was rejected: %v", err)
	}
	if version.Kind != model.SkillKindAgent || version.EntryPoints != `["canvas"]` {
		t.Fatalf("unexpected agent version: %#v", version)
	}
}

func TestSimpleLegacyPresetVersionGuard(t *testing.T) {
	version := model.SkillVersion{
		Kind: model.SkillKindPreset, Status: model.SkillVersionPublished,
		EntryPoints:       `["studio","chat","canvas"]`,
		PrimaryOutputType: "image", OutputTypes: `["image"]`,
		InputSchema:    `{"type":"object","properties":{}}`,
		ManifestJSON:   `{"kind":"preset","primaryOutputType":"image","outputTypes":["image"]}`,
		PromptTemplate: "cinematic", PrimaryFilePath: "SKILL.md",
	}
	files := []model.SkillFile{{Path: "SKILL.md", Content: "cinematic"}}
	if !isSimpleLegacyPresetVersion(&version, files) {
		t.Fatal("simple preset was classified as advanced")
	}

	historical := version
	historical.PromptTemplate = "  cinematic  "
	historical.ManifestJSON = `{"kind":"preset","promptTemplate":"  cinematic  ","modelId":"","defaultParams":{},"primaryOutputType":"image","outputTypes":["image"]}`
	if !isSimpleLegacyPresetVersion(&historical, files) {
		t.Fatal("historical backfilled preset was classified as advanced")
	}
	semanticDefaults := version
	semanticDefaults.ModelID = "model-a"
	semanticDefaults.DefaultParams = `{"a":1,"b":2}`
	semanticDefaults.ManifestJSON = `{"kind":"preset","promptTemplate":"cinematic","modelId":"model-a","defaultParams":{"b":2,"a":1},"primaryOutputType":"image","outputTypes":["image"]}`
	if !isSimpleLegacyPresetVersion(&semanticDefaults, files) {
		t.Fatal("semantically equivalent historical manifest was classified as advanced")
	}

	cases := []struct {
		name  string
		alter func(*model.SkillVersion, *[]model.SkillFile)
	}{
		{name: "multiple files", alter: func(_ *model.SkillVersion, fs *[]model.SkillFile) {
			*fs = append(*fs, model.SkillFile{Path: "references/style.md", Content: "style"})
		}},
		{name: "custom primary", alter: func(v *model.SkillVersion, fs *[]model.SkillFile) {
			v.PrimaryFilePath = "Package/SKILL.md"
			(*fs)[0].Path = "Package/SKILL.md"
		}},
		{name: "file reference", alter: func(v *model.SkillVersion, fs *[]model.SkillFile) {
			v.PromptTemplate = "{{skill.primary}}"
			(*fs)[0].Content = "{{skill.primary}}"
		}},
		{name: "custom input", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.InputSchema = `{"type":"object","properties":{"prompt":{"type":"string"}}}`
		}},
		{name: "missing input object type", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.InputSchema = `{}`
		}},
		{name: "custom manifest", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.ManifestJSON = `{"kind":"preset","primaryOutputType":"image","outputTypes":["image"],"preferredNodeType":"character"}`
		}},
		{name: "manifest prompt mismatch", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.ManifestJSON = `{"kind":"preset","promptTemplate":"different","primaryOutputType":"image","outputTypes":["image"]}`
		}},
		{name: "manifest model mismatch", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.ManifestJSON = `{"kind":"preset","modelId":"different","primaryOutputType":"image","outputTypes":["image"]}`
		}},
		{name: "manifest defaults mismatch", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.ManifestJSON = `{"kind":"preset","defaultParams":{"quality":"high"},"primaryOutputType":"image","outputTypes":["image"]}`
		}},
		{name: "limited entrypoints", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.EntryPoints = `["canvas"]`
		}},
		{name: "multiple outputs", alter: func(v *model.SkillVersion, _ *[]model.SkillFile) {
			v.OutputTypes = `["image","text"]`
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := version
			candidateFiles := append([]model.SkillFile(nil), files...)
			tc.alter(&candidate, &candidateFiles)
			if isSimpleLegacyPresetVersion(&candidate, candidateFiles) {
				t.Fatal("advanced preset was classified as simple")
			}
		})
	}
}

func TestLegacyPresetExecutionEditableTxLoadsPinnedVersion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:legacy-preset-guard?mode=memory&cache=shared"), &gorm.Config{})
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
		BaseModel: model.BaseModel{ID: idgen.ID(1)}, Title: "skill", Kind: model.SkillKindPreset,
		OutputType: "image", PromptTemplate: "cinematic",
	}
	version := model.SkillVersion{
		BaseModel: model.BaseModel{ID: idgen.ID(2)}, SkillID: skill.ID, Version: 1,
		Kind: model.SkillKindPreset, Status: model.SkillVersionPublished,
		EntryPoints: `["chat","studio","canvas"]`, PrimaryOutputType: "image", OutputTypes: `["image"]`,
		InputSchema: `{"type":"object"}`, ManifestJSON: `{"kind":"preset","primaryOutputType":"image","outputTypes":["image"]}`,
		PromptTemplate: "cinematic", PrimaryFilePath: "SKILL.md",
	}
	skill.CurrentVersionID = version.ID
	file := model.SkillFile{
		BaseModel: model.BaseModel{ID: idgen.ID(3)}, SkillVersionID: version.ID,
		Path: "SKILL.md", Content: "cinematic",
	}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		editable, err := legacyPresetExecutionEditableTx(tx, &skill)
		if err != nil {
			return err
		}
		if !editable {
			t.Fatal("simple pinned preset was classified as advanced")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	extra := model.SkillFile{
		BaseModel: model.BaseModel{ID: idgen.ID(4)}, SkillVersionID: version.ID,
		Path: "references/style.md", Content: "style",
	}
	if err := db.Create(&extra).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		editable, err := legacyPresetExecutionEditableTx(tx, &skill)
		if err != nil {
			return err
		}
		if editable {
			t.Fatal("multi-file pinned preset was classified as simple")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSkillFileReferencesSupportsNestedPackageRoot(t *testing.T) {
	files := []model.SkillFile{
		{Path: "MySkill/SKILL.md", Content: "Use {{skill.file:references/style.md}}"},
		{Path: "MySkill/references/style.md", Content: "cinematic"},
	}
	if err := validateSkillFileReferences(`{"steps":[{"prompt":"{{skill.primary}}"}]}`, files, "MySkill/SKILL.md"); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSkillManifestRejectsGenerateHandlerModalityMismatch(t *testing.T) {
	raw := json.RawMessage(`{"kind":"agent","steps":[{"key":"make","type":"generate","handler":"text_to_video","outputType":"image","outputRole":"final"}]}`)
	if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image", "video"}); err == nil {
		t.Fatal("expected modality mismatch to be rejected")
	}
}

func TestValidateSkillManifestRejectsStepTypeOutputMismatch(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","handler":"skill_text_completion","outputType":"image","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"text","outputRole":"final"}]}`),
	} {
		if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image", "text"}); err == nil {
			t.Fatalf("step type/output mismatch was accepted: %s", raw)
		}
	}
}

func TestValidateAssetWildcardRequiresImageOnlyOutput(t *testing.T) {
	version := &model.SkillVersion{Kind: model.SkillKindPreset, PrimaryOutputType: "video",
		BindingsJSON: `[{"surface":"asset","targetType":"*","enabled":true}]`}
	if err := validateAssetBindingOutputs(version); err == nil {
		t.Fatal("asset wildcard accepted a non-image output")
	}
	version.BindingsJSON = `[{"surface":"asset","targetType":"general","enabled":true}]`
	if err := validateAssetBindingOutputs(version); err != nil {
		t.Fatalf("general asset binding was incorrectly restricted: %v", err)
	}
}

func TestDefaultAdminSkillBindingTargetKeepsNonImageAssetsGeneral(t *testing.T) {
	cases := []struct {
		surface string
		output  string
		want    string
	}{
		{surface: "asset", output: "image", want: "*"},
		{surface: "asset", output: "text", want: "general"},
		{surface: "asset", output: "video", want: "general"},
		{surface: "canvas", output: "video", want: "*"},
	}
	for _, tc := range cases {
		if got := defaultAdminSkillBindingTarget(tc.surface, tc.output); got != tc.want {
			t.Fatalf("default target for %s/%s = %q, want %q", tc.surface, tc.output, got, tc.want)
		}
	}
}

func TestValidateInputSchemaDefinitionRejectsUnsupportedOrMalformedConstraints(t *testing.T) {
	valid := json.RawMessage(`{"type":"object","properties":{"assets":{"type":"array","minItems":1,"items":{"type":"object","required":["url"],"properties":{"url":{"type":"string","pattern":"^https://"}}}}}}`)
	if err := validateInputSchemaDefinition(valid); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","minLenght":2}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"array","minItems":-1}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","pattern":"["}}}`),
	} {
		if err := validateInputSchemaDefinition(raw); err == nil {
			t.Fatalf("invalid input schema was accepted: %s", raw)
		}
	}
}

func TestValidateSkillManifestApprovalPromotionIsExplicit(t *testing.T) {
	raw := json.RawMessage(`{"kind":"agent","steps":[{"key":"draft","type":"generate","outputType":"image","outputRole":"intermediate"},{"key":"approve","type":"approval","promotePrevious":true}]}`)
	if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image"}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSkillManifestRequiresPrimaryFinalOutput(t *testing.T) {
	raw := json.RawMessage(`{"kind":"agent","steps":[{"type":"text","outputType":"text","outputRole":"final"}]}`)
	if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image", "text"}); err == nil {
		t.Fatal("agent with a text-only final output accepted image as its primary output")
	}
}

func TestValidateSkillManifestRejectsControlStepOutputs(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"image","outputRole":"intermediate"},{"type":"approval","promotePrevious":true,"outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"image","outputRole":"intermediate"},{"type":"approval","promotePrevious":true,"registerWork":true}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"image","outputRole":"intermediate"},{"type":"approval","promotePrevious":true,"outputType":"image"}]}`),
	} {
		if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image"}); err == nil {
			t.Fatalf("control-step output configuration was accepted: %s", raw)
		}
	}
}

func TestValidateSkillManifestStrictJSONAndWorkVisibility(t *testing.T) {
	invalid := []json.RawMessage{
		json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","outputType":"image","outputRole":"final","strictJson":true}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","outputType":"text","outputRole":"intermediate","registerWork":true},{"type":"text","outputType":"text","outputRole":"final"}]}`),
	}
	for _, raw := range invalid {
		if err := validateSkillManifest(raw, model.SkillKindAgent, "image", []string{"image", "text"}); err == nil {
			t.Fatalf("invalid manifest was accepted: %s", raw)
		}
	}
}

func TestValidateSkillManifestRejectsInvalidWaitingStepSchema(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"kind":"agent","steps":[{"type":"input","schema":{"type":"notatype"}},{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","outputType":"text","outputRole":"intermediate"},{"type":"approval","promotePrevious":true,"schema":{"type":"object","properties":{"x":{"minLenght":2}}}}]}`),
	} {
		if err := validateSkillManifest(raw, model.SkillKindAgent, "text", []string{"text"}); err == nil {
			t.Fatalf("invalid waiting-step schema was accepted: %s", raw)
		}
	}
}
