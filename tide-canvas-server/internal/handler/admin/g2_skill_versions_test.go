package admin

import (
	"encoding/json"
	"fmt"
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

func TestDecodeAdminSkillImportRequestRejectsUnknownAndTrailingJSON(t *testing.T) {
	for _, raw := range []string{
		`{"skills":[],"skillz":[]}`,
		`{"skills":[]} {"skills":[]}`,
	} {
		var dto AdminSkillImportDTO
		if err := decodeAdminSkillImportRequest(strings.NewReader(raw), &dto); err == nil {
			t.Fatalf("invalid import JSON was accepted: %s", raw)
		}
	}
	var dto AdminSkillImportDTO
	err := decodeAdminSkillImportRequest(strings.NewReader(`{"skills":[],"skillz":[]}`), &dto)
	if message := describeSkillImportRequestError(err, "导入"); !strings.Contains(message, "未知字段") || !strings.Contains(message, "skillz") {
		t.Fatalf("unknown-field reason = %q", message)
	}
}

func TestValidateAdminSkillImportsReportsNamedReasonsAndRejectsWholeBatch(t *testing.T) {
	valid := AdminSkillPackageDTO{
		Title: "导演审片", AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{
			Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
			PrimaryOutputType: "text", OutputTypes: []string{"text"},
			PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: "# Review"}},
		},
	}
	invalid := valid
	invalid.Title = "错误入口"
	invalid.EntryPoints = []string{"studio"}

	result, prepared := validateAdminSkillImports(nil, []AdminSkillPackageDTO{valid, invalid}, 0)
	if result.Valid || prepared != nil {
		t.Fatalf("invalid batch was prepared: result=%#v prepared=%#v", result, prepared)
	}
	if len(result.Items) != 2 || !result.Items[0].Valid || result.Items[1].Valid {
		t.Fatalf("unexpected validation items: %#v", result.Items)
	}
	if len(result.Items[1].Errors) != 1 || !strings.Contains(result.Items[1].Errors[0], "画布入口") {
		t.Fatalf("missing actionable reason: %#v", result.Items[1])
	}
	message := formatSkillImportValidationFailure(result)
	if !strings.Contains(message, "错误入口") || !strings.Contains(message, "画布入口") {
		t.Fatalf("unexpected failure summary: %s", message)
	}
}

func TestSkillImportAnalysisModelCapabilityMatchesMediaPreparation(t *testing.T) {
	if !skillImportAnalysisModelSupports("analyze_webpage", model.MarketModel{}) {
		t.Fatal("webpage analysis should not require file upload")
	}
	videoCapable := model.MarketModel{Config: `{"fileUpload":true,"uploadFormats":["png","jpg"]}`}
	if !skillImportAnalysisModelSupports("analyze_video", videoCapable) {
		t.Fatal("video analysis rejected a keyframe-capable text model")
	}
	if skillImportAnalysisModelSupports("analyze_video", model.MarketModel{Config: `{"fileUpload":true,"uploadFormats":["pdf"]}`}) {
		t.Fatal("video analysis accepted a text model without image input")
	}
	if skillImportAnalysisModelSupports("analyze_audio", model.MarketModel{Config: `{"fileUpload":false}`}) {
		t.Fatal("audio analysis accepted a text model with file upload disabled")
	}
}

func TestSkillImportTreatsFileOutputModelAsText(t *testing.T) {
	if got := skillImportModelType(" file "); got != "text" {
		t.Fatalf("file output model type = %q, want text", got)
	}
}

func TestNormalizeSkillFilesRejectsCaseDuplicatesAndBlankPrimary(t *testing.T) {
	if _, _, err := normalizeSkillFiles([]AdminSkillFileDTO{
		{Path: "SKILL.md", Content: "one"},
		{Path: "skill.md", Content: "two"},
	}, "SKILL.md"); err == nil {
		t.Fatal("case-insensitive duplicate paths were accepted")
	}
	if _, _, err := normalizeSkillFiles([]AdminSkillFileDTO{{Path: "SKILL.md", Content: " \n\t"}}, "SKILL.md"); err == nil {
		t.Fatal("blank primary file was accepted")
	}
}

func TestBuildSkillVersionPinsEveryImportedTextFileIntoExecutablePrompt(t *testing.T) {
	skill := &model.Skill{OutputType: "text"}
	version, _, err := buildSkillVersion(nil, skill, AdminSkillVersionCreateDTO{
		Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
		PrimaryOutputType: "text", OutputTypes: []string{"text"}, PrimaryFilePath: "SKILL.md",
		Files: []AdminSkillFileDTO{
			{Path: "SKILL.md", Content: "Read the review rules."},
			{Path: "references/rules.md", Content: "Always cite visible evidence."},
			{Path: "references/output.txt", Content: "Return a release decision first."},
		},
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"{{skill.primary}}", "{{skill.file:references/rules.md}}", "{{skill.file:references/output.txt}}"} {
		if !strings.Contains(version.PromptTemplate, token) {
			t.Fatalf("generated package prompt is missing %s: %s", token, version.PromptTemplate)
		}
	}
}

func TestBuildSkillVersionPreservesNativeExplicitPackageReferences(t *testing.T) {
	skill := &model.Skill{OutputType: "text"}
	version, _, err := buildSkillVersion(nil, skill, AdminSkillVersionCreateDTO{
		Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
		PrimaryOutputType: "text", OutputTypes: []string{"text"}, PrimaryFilePath: "SKILL.md",
		Files: []AdminSkillFileDTO{
			{Path: "SKILL.md", Content: "Use {{skill.file:references/rules.md}}"},
			{Path: "references/rules.md", Content: "Keep the evidence visible."},
			{Path: "references/optional.md", Content: "Optional appendix."},
		},
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if version.PromptTemplate != "{{skill.primary}}" {
		t.Fatalf("native references were duplicated by generated wrapper: %s", version.PromptTemplate)
	}
}

func TestBuildSkillVersionRejectsPackageWhoseExpandedPromptIsTooLarge(t *testing.T) {
	skill := &model.Skill{OutputType: "text"}
	_, _, err := buildSkillVersion(nil, skill, AdminSkillVersionCreateDTO{
		Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
		PrimaryOutputType: "text", OutputTypes: []string{"text"}, PrimaryFilePath: "SKILL.md",
		Files: []AdminSkillFileDTO{
			{Path: "SKILL.md", Content: strings.Repeat("a", 600_000)},
			{Path: "references/rules.md", Content: strings.Repeat("b", 600_000)},
		},
	}, 0)
	if err == nil || !strings.Contains(err.Error(), "expanded prompt exceeds 1 MiB") {
		t.Fatalf("oversized expanded package prompt error = %v", err)
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

func TestBuildSkillVersionRejectsValuesThatCannotBePersistedSafely(t *testing.T) {
	skill := &model.Skill{OutputType: "text"}
	base := AdminSkillVersionCreateDTO{
		Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
		PrimaryOutputType: "text", OutputTypes: []string{"text"}, PromptTemplate: "instructions",
	}
	tooLongModel := base
	tooLongModel.ModelID = strings.Repeat("m", maxSkillModelIDRunes+1)
	if _, _, err := buildSkillVersion(nil, skill, tooLongModel, 0); err == nil {
		t.Fatal("oversized modelId was accepted")
	}

	tooLargeDefaults := base
	tooLargeDefaults.DefaultParams = json.RawMessage(`{"value":"` + strings.Repeat("d", maxSkillDefaultParamsBytes) + `"}`)
	if _, _, err := buildSkillVersion(nil, skill, tooLargeDefaults, 0); err == nil {
		t.Fatal("defaultParams larger than the catalog TEXT column was accepted")
	}

	badMIME := base
	badMIME.PromptTemplate = ""
	badMIME.PrimaryFilePath = "SKILL.md"
	badMIME.Files = []AdminSkillFileDTO{{Path: "SKILL.md", Content: "instructions", MimeType: strings.Repeat("m", maxSkillMimeTypeRunes+1)}}
	if _, _, err := buildSkillVersion(nil, skill, badMIME, 0); err == nil {
		t.Fatal("oversized file mimeType was accepted")
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
	if err := validateSkillFileReferences(`{"steps":[{"prompt":"{{skill.primary}}"}]}`, "", files, "MySkill/SKILL.md"); err != nil {
		t.Fatal(err)
	}
	if err := validateSkillFileReferences(`{"kind":"agent"}`, "{{skill.flie:references/style.md}}", files, "MySkill/SKILL.md"); err == nil {
		t.Fatal("misspelled skill reference was accepted")
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

func TestValidateSkillManifestRejectsSilentlyIgnoredFieldShapes(t *testing.T) {
	invalid := []json.RawMessage{
		json.RawMessage(`{"kind":7,"steps":[{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","step":[{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","primaryOutputType":"video","steps":[{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","outputTypes":["image"],"steps":[{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","preferredNodeType":"unknown","steps":[{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"key":9,"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","prompt":9,"outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","preferredNodeType":"unknown","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","ouputType":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"approval","modelId":"ignored"},{"type":"text","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"agent","steps":[{"type":"text","schema":{},"outputType":"text","outputRole":"final"}]}`),
	}
	for _, raw := range invalid {
		if err := validateSkillManifest(raw, model.SkillKindAgent, "text", []string{"text"}); err == nil {
			t.Fatalf("malformed manifest field was accepted: %s", raw)
		}
	}
	generateWithIgnoredField := json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","systemPrompt":"ignored","outputType":"image","outputRole":"final"}]}`)
	if err := validateSkillManifest(generateWithIgnoredField, model.SkillKindAgent, "image", []string{"image"}); err == nil {
		t.Fatalf("ignored generate field was accepted: %s", generateWithIgnoredField)
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
	if err := validateInputSchemaDefinition(json.RawMessage(`{"type":"object","x-asset-types":[],"required":["url"],"properties":{"url":{"type":"string"}}}`)); err != nil {
		t.Fatalf("explicit no-asset schema was rejected: %v", err)
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","minLenght":2}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"array","minItems":-1}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","pattern":"["}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","title":7}}}`),
		json.RawMessage(`{"type":"object","properties":{"x":{"type":"string","minLength":9,"maxLength":2}}}`),
		json.RawMessage(`{"type":"object","x-asset-types":["video","video"]}`),
		json.RawMessage(`{"type":"object","x-asset-types":["unknown"]}`),
	} {
		if err := validateInputSchemaDefinition(raw); err == nil {
			t.Fatalf("invalid input schema was accepted: %s", raw)
		}
	}
	properties := map[string]any{}
	for index := 0; index < 129; index++ {
		properties[fmt.Sprintf("field_%d", index)] = map[string]any{"type": "string"}
	}
	oversized, _ := json.Marshal(map[string]any{"type": "object", "properties": properties})
	if err := validateInputSchemaDefinition(oversized); err == nil {
		t.Fatal("input schema with more than 128 properties was accepted")
	}
}

func TestNormalizeSkillBindingSnapshotsEnforcesPersistenceLimits(t *testing.T) {
	bindings := make([]AdminSkillBindingDTO, maxSkillImportBindings+1)
	if _, err := normalizeSkillBindingSnapshots(bindings); err == nil {
		t.Fatal("oversized binding list was accepted")
	}
	tooLargeDefaults := json.RawMessage(`{"value":"` + strings.Repeat("d", maxSkillBindingDefaultsBytes) + `"}`)
	if _, err := normalizeSkillBindingSnapshots([]AdminSkillBindingDTO{{Surface: "canvas", TargetType: "*", Defaults: tooLargeDefaults}}); err == nil {
		t.Fatal("binding defaults larger than the live TEXT column were accepted")
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

func TestValidateSkillManifestAcceptsRegisteredToolPipeline(t *testing.T) {
	raw := json.RawMessage(`{"kind":"tool","steps":[{"key":"prepare","type":"text","handler":"skill_text_completion","outputType":"text","outputRole":"intermediate"},{"key":"render","type":"tool","handler":"render_docx","outputType":"file","outputRole":"final"}]}`)
	if err := validateSkillManifest(raw, model.SkillKindTool, "file", []string{"text", "file"}); err != nil {
		t.Fatal(err)
	}
	imageAnalysis := json.RawMessage(`{"kind":"tool","steps":[{"key":"inspect","type":"tool","handler":"analyze_image","outputType":"text","outputRole":"final"}]}`)
	if err := validateSkillManifest(imageAnalysis, model.SkillKindTool, "text", []string{"text"}); err != nil {
		t.Fatalf("runtime-supported image analysis was rejected: %v", err)
	}
}

func TestValidateSkillManifestRejectsUnsafeOrMismatchedTools(t *testing.T) {
	invalid := []json.RawMessage{
		json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"run_shell","outputType":"file","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"render_pptx","outputType":"text","outputRole":"final"}]}`),
		json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"analyze_video","outputType":"file","outputRole":"final"}]}`),
	}
	for _, raw := range invalid {
		if err := validateSkillManifest(raw, model.SkillKindTool, "file", []string{"text", "file"}); err == nil {
			t.Fatalf("invalid tool manifest was accepted: %s", raw)
		}
	}
}

func TestValidateSkillManifestInputContractMatchesSelectedSchema(t *testing.T) {
	videoSchema := json.RawMessage(`{"type":"object","x-asset-types":["video"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":1}}}`)
	videoManifest := json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"analyze_video","outputType":"text","outputRole":"final"}]}`)
	if err := validateSkillManifestInputContract(videoManifest, videoSchema, model.SkillKindTool, "text"); err != nil {
		t.Fatalf("matching video schema was rejected: %v", err)
	}
	audioManifest := json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"analyze_audio","outputType":"text","outputRole":"final"}]}`)
	if err := validateSkillManifestInputContract(audioManifest, videoSchema, model.SkillKindTool, "text"); err == nil {
		t.Fatal("audio handler was accepted with a video-only schema")
	}
	mixedAnalysisSchema := json.RawMessage(`{"type":"object","x-asset-types":["video","image"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":4}}}`)
	if err := validateSkillManifestInputContract(videoManifest, mixedAnalysisSchema, model.SkillKindTool, "text"); err == nil {
		t.Fatal("single-media analysis handler was accepted with an ambiguous mixed schema")
	}
	unboundedVideoSchema := json.RawMessage(`{"type":"object","x-asset-types":["video"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":3}}}`)
	if err := validateSkillManifestInputContract(videoManifest, unboundedVideoSchema, model.SkillKindTool, "text"); err == nil {
		t.Fatal("single-video analysis handler was accepted with more than one allowed video")
	}
	optionalVideoSchema := json.RawMessage(`{"type":"object","x-asset-types":["video"],"properties":{"assets":{"type":"array","minItems":1}}}`)
	if err := validateSkillManifestInputContract(videoManifest, optionalVideoSchema, model.SkillKindTool, "text"); err == nil {
		t.Fatal("video handler was accepted without required assets")
	}
	webManifest := json.RawMessage(`{"kind":"tool","steps":[{"type":"tool","handler":"analyze_webpage","outputType":"text","outputRole":"final"}]}`)
	if err := validateSkillManifestInputContract(webManifest, json.RawMessage(`{"type":"object","required":["url"],"properties":{"url":{"type":"string"}}}`), model.SkillKindTool, "text"); err != nil {
		t.Fatalf("matching webpage schema was rejected: %v", err)
	}
	if err := validateSkillManifestInputContract(webManifest, json.RawMessage(`{"type":"object","properties":{}}`), model.SkillKindTool, "text"); err == nil {
		t.Fatal("webpage handler was accepted without a url field")
	}
	if err := validateSkillManifestInputContract(webManifest, json.RawMessage(`{"type":"object","x-asset-types":["image"],"required":["url"],"properties":{"url":{"type":"string"}}}`), model.SkillKindTool, "text"); err == nil {
		t.Fatal("webpage handler was accepted with ignored asset input")
	}
	if err := validateSkillManifestInputContract(webManifest, json.RawMessage(`{"type":"object","required":["url"],"properties":{"url":{"type":"string"},"assets":{"type":"array"}}}`), model.SkillKindTool, "text"); err == nil {
		t.Fatal("webpage handler was accepted with an optional ignored assets field")
	}
	keyframeManifest := json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","handler":"start_end_to_video","outputType":"video","outputRole":"final"}]}`)
	keyframeSchema := json.RawMessage(`{"type":"object","x-asset-types":["image"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":2,"maxItems":2}}}`)
	if err := validateSkillManifestInputContract(keyframeManifest, keyframeSchema, model.SkillKindAgent, "video"); err != nil {
		t.Fatalf("matching keyframe schema was rejected: %v", err)
	}
	if err := validateSkillManifestInputContract(keyframeManifest, json.RawMessage(`{"type":"object","x-asset-types":["image"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":9}}}`), model.SkillKindAgent, "video"); err == nil {
		t.Fatal("start/end handler was accepted without exactly two assets")
	}
	imageVideoManifest := json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","handler":"image_to_video","outputType":"video","outputRole":"final"}]}`)
	if err := validateSkillManifestInputContract(imageVideoManifest, keyframeSchema, model.SkillKindAgent, "video"); err == nil {
		t.Fatal("single-frame image-to-video handler was accepted with two images")
	}
	textVideoManifest := json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","handler":"text_to_video","outputType":"video","outputRole":"final"}]}`)
	if err := validateSkillManifestInputContract(textVideoManifest, keyframeSchema, model.SkillKindAgent, "video"); err == nil {
		t.Fatal("text-to-video handler was accepted with ignored image input")
	}
	referenceManifest := json.RawMessage(`{"kind":"agent","steps":[{"type":"generate","handler":"reference_to_video","outputType":"video","outputRole":"final"}]}`)
	mediaSchema := json.RawMessage(`{"type":"object","x-asset-types":["image","video","audio"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":12}}}`)
	if err := validateSkillManifestInputContract(referenceManifest, mediaSchema, model.SkillKindAgent, "video"); err != nil {
		t.Fatalf("matching multimedia reference schema was rejected: %v", err)
	}
	mediaAndFileSchema := json.RawMessage(`{"type":"object","x-asset-types":["image","file"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":12}}}`)
	if err := validateSkillManifestInputContract(referenceManifest, mediaAndFileSchema, model.SkillKindAgent, "video"); err == nil {
		t.Fatal("reference video handler accepted a schema that permits unsupported files")
	}
	if err := validateSkillManifestInputContract(json.RawMessage(`{"kind":"agent"}`), videoSchema, model.SkillKindAgent, "video"); err != nil {
		t.Fatalf("generic agent was rejected by the schema contract: %v", err)
	}
	presetManifest := json.RawMessage(`{"kind":"preset","primaryOutputType":"video","outputTypes":["video"]}`)
	singleImageSchema := json.RawMessage(`{"type":"object","x-asset-types":["image"],"required":["assets"],"properties":{"assets":{"type":"array","minItems":1,"maxItems":1}}}`)
	if err := validateSkillManifestInputContract(presetManifest, singleImageSchema, model.SkillKindPreset, "video"); err != nil {
		t.Fatalf("single-image preset video input was rejected: %v", err)
	}
	if err := validateSkillManifestInputContract(presetManifest, keyframeSchema, model.SkillKindPreset, "video"); err == nil {
		t.Fatal("preset video accepted keyframes even though preset execution cannot select start/end mode")
	}
	if err := validateSkillManifestInputContract(presetManifest, mediaSchema, model.SkillKindPreset, "video"); err == nil {
		t.Fatal("preset video accepted multi-reference input even though preset execution cannot select omni-reference mode")
	}
}

func TestValidateSkillKindContractRestrictsToolProductsAndSurfaces(t *testing.T) {
	valid := &model.SkillVersion{Kind: model.SkillKindTool, PrimaryOutputType: "file", OutputTypes: `["text","file"]`, EntryPoints: `["studio","api"]`, BindingsJSON: `[{"surface":"api","targetType":"*","enabled":true}]`}
	if err := validateSkillKindContract(valid); err != nil {
		t.Fatal(err)
	}
	for _, version := range []*model.SkillVersion{
		{Kind: model.SkillKindTool, PrimaryOutputType: "image", OutputTypes: `["image"]`, EntryPoints: `["studio"]`},
		{Kind: model.SkillKindTool, PrimaryOutputType: "text", OutputTypes: `["text"]`, EntryPoints: `["canvas"]`},
	} {
		if err := validateSkillKindContract(version); err == nil {
			t.Fatalf("invalid tool contract was accepted: %#v", version)
		}
	}
}

func TestNormalizeSkillBindingSnapshotsAcceptsToolAPISurface(t *testing.T) {
	enabled := true
	bindings, err := normalizeSkillBindingSnapshots([]AdminSkillBindingDTO{{Surface: "api", TargetType: "*", Enabled: &enabled}})
	if err != nil {
		t.Fatal(err)
	}
	if len(bindings) != 1 || bindings[0].Surface != "api" {
		t.Fatalf("unexpected bindings: %#v", bindings)
	}
}
