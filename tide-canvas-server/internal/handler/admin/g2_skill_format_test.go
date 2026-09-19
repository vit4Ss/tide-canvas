package admin

import (
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

func standardSkillText(name string) string {
	return "---\nname: " + name + "\ndescription: Review videos when checking continuity.\n---\n\n# Review\nCite visible evidence."
}

func TestStandardSkillFormatAcceptsYAMLAndReferenceFiles(t *testing.T) {
	for _, content := range []string{
		standardSkillText("video-review"),
		"\ufeff" + strings.ReplaceAll(standardSkillText("video-review"), "\n", "\r\n"),
		"---\nname: video-review\ndescription: >-\n  Review videos\n  when checking continuity.\nlicense: MIT\ncompatibility: Requires video inputs\nallowed-tools: Read Bash(ffmpeg:*)\nmetadata:\n  author: Example\n  version: \"1.0\"\n---\n# Review instructions",
	} {
		metadata, err := validateStandardSkillPackage([]AdminSkillFileDTO{
			{Path: "video-review/SKILL.md", Content: content},
			{Path: "video-review/references/rules.md", Content: "Reference files do not need frontmatter"},
		}, "video-review/SKILL.md")
		if err != nil || metadata.Name != "video-review" {
			t.Fatalf("metadata=%#v err=%v", metadata, err)
		}
		if strings.Contains(content, ">-") && metadata.Description != "Review videos when checking continuity." {
			t.Fatalf("multiline description = %q", metadata.Description)
		}
	}
}

func TestStandardSkillFormatRejectsNonSkills(t *testing.T) {
	cases := []struct{ name, document, want string }{
		{"plain instructions", "# A useful prompt\nDo the task", "YAML"},
		{"frontmatter only", "---\nname: review\ndescription: Review\n---", "正文"},
		{"missing closing delimiter", "---\nname: review\ndescription: Review", "结束分隔符"},
		{"yaml syntax", "---\nname: [oops\ndescription: Review\n---\nBody", "语法"},
		{"yaml list", "---\n- name: review\n---\nBody", "键值对象"},
		{"missing name", "---\ndescription: Review\n---\nBody", "name"},
		{"missing description", "---\nname: review\n---\nBody", "description"},
		{"numeric name", "---\nname: 123\ndescription: Review\n---\nBody", "name"},
		{"array description", "---\nname: review\ndescription: [Review]\n---\nBody", "description"},
		{"blank description", "---\nname: review\ndescription: '  '\n---\nBody", "description"},
		{"duplicate key", "---\nname: review\nname: review-again\ndescription: Review\n---\nBody", "重复"},
		{"invalid optional field", "---\nname: review\ndescription: Review\nallowed-tools: [Read]\n---\nBody", "allowed-tools"},
		{"nested metadata", "---\nname: review\ndescription: Review\nmetadata:\n  nested: [1, 2]\n---\nBody", "metadata"},
		{"duplicate metadata", "---\nname: review\ndescription: Review\nmetadata:\n  a: one\n  a: two\n---\nBody", "metadata"},
		{"unknown field", "---\nname: review\ndescription: Review\nrandom-option: true\n---\nBody", "metadata"},
		{"uppercase name", standardSkillText("Review"), "name"},
		{"underscore name", standardSkillText("video_review"), "name"},
		{"consecutive hyphen", standardSkillText("video--review"), "name"},
		{"leading hyphen", standardSkillText("-review"), "name"},
		{"long name", standardSkillText(strings.Repeat("a", 65)), "name"},
		{"long description", "---\nname: review\ndescription: " + strings.Repeat("中", 1025) + "\n---\nBody", "description"},
		{"long compatibility", "---\nname: review\ndescription: Review\ncompatibility: " + strings.Repeat("x", 501) + "\n---\nBody", "compatibility"},
		{"NUL", standardSkillText("review") + "\x00", "UTF-8"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateStandardSkillPackage([]AdminSkillFileDTO{{Path: "SKILL.md", Content: tc.document}}, "SKILL.md")
			if err == nil || !strings.Contains(err.Error(), tc.want) && !strings.Contains(err.Error(), "NUL") {
				t.Fatalf("error=%v, want %s", err, tc.want)
			}
		})
	}
}

func TestStandardSkillFormatRequiresMainFileAndMatchingDirectory(t *testing.T) {
	for _, name := range []string{"prompt.txt", "review.md", "skill.md", "wrong/SKILL.md"} {
		if _, err := validateStandardSkillPackage([]AdminSkillFileDTO{{Path: name, Content: standardSkillText("review")}}, name); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	if _, err := validateStandardSkillPackage(nil, ""); err == nil {
		t.Fatal("accepted no files")
	}
	_, err := validateStandardSkillPackage([]AdminSkillFileDTO{{Path: "review/SKILL.md", Content: standardSkillText("review")}, {Path: "outside.txt", Content: "outside"}}, "review/SKILL.md")
	if err == nil || !strings.Contains(err.Error(), "所属目录") {
		t.Fatalf("error=%v", err)
	}
	_, err = validateStandardSkillPackage([]AdminSkillFileDTO{{Path: "SKILL.md", Content: standardSkillText("review")}, {Path: "nested/SKILL.md", Content: standardSkillText("nested")}}, "SKILL.md")
	if err == nil {
		t.Fatal("accepted several main files in one package")
	}
}

func TestSkillFormatPreflightReportsEveryPackageWithoutDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body, _ := json.Marshal(map[string]any{"packages": []AdminSkillFilePackageDTO{
		{PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: standardSkillText("review")}}},
		{PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: "A non-skill prompt"}}},
	}})
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/skills/validate-files", strings.NewReader(string(body)))
	(&skillsHandler{}).validateSkillFiles(ctx)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Valid bool                      `json:"valid"`
			Items []skillFileValidationItem `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Data.Valid || len(result.Data.Items) != 2 || !result.Data.Items[0].Valid || result.Data.Items[1].Valid {
		t.Fatalf("response=%s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"name":"review"`) {
		t.Fatalf("missing parsed metadata: %s", response.Body.String())
	}
}

func TestInvalidSkillCannotBypassImportWithValidManifest(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Skill{BaseModel: model.BaseModel{ID: idgen.ID(10)}, Title: "Existing", Kind: "agent", OutputType: "text"}).Error; err != nil {
		t.Fatal(err)
	}
	h := &skillsHandler{db: db}
	r := gin.New()
	s := r.Group("/skills")
	s.POST("/import", h.importSkills)
	s.POST("/validate-import", h.validateSkillImport)
	registerSkillVersionRoutes(s, h)
	invalid := AdminSkillVersionCreateDTO{Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "text", OutputTypes: []string{"text"}, Manifest: json.RawMessage(`{"kind":"agent"}`), PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: "Plain prompt disguised as SKILL.md"}}}
	valid := invalid
	valid.Files = []AdminSkillFileDTO{{Path: "SKILL.md", Content: standardSkillText("review")}}
	batch := AdminSkillImportDTO{Skills: []AdminSkillPackageDTO{{Title: "Good", AdminSkillVersionCreateDTO: valid}, {Title: "Bad", AdminSkillVersionCreateDTO: invalid}}}
	for _, endpoint := range []string{"/skills/import", "/skills/validate-import", "/skills/10/versions/import", "/skills/10/versions"} {
		var body []byte
		if strings.Contains(endpoint, "/10/") {
			body, _ = json.Marshal(invalid)
		} else {
			body, _ = json.Marshal(batch)
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(recorder, request)
		if !strings.Contains(recorder.Body.String(), "格式不符合规范") {
			t.Fatalf("%s response=%s", endpoint, recorder.Body.String())
		}
	}
	var skills, versions, files int64
	db.Model(&model.Skill{}).Count(&skills)
	db.Model(&model.SkillVersion{}).Count(&versions)
	db.Model(&model.SkillFile{}).Count(&files)
	if skills != 1 || versions != 0 || files != 0 {
		t.Fatalf("invalid package caused writes: skills=%d versions=%d files=%d", skills, versions, files)
	}
}

func TestArchiveSkillFormatCannotBeBypassed(t *testing.T) {
	for _, entries := range [][]struct{ name, content string }{
		{{"review/SKILL.md", "No YAML here"}},
		{{"wrong-name/SKILL.md", standardSkillText("review")}},
		{{"review/skill.md", standardSkillText("review")}},
	} {
		if _, err := inspectSkillArchive(archiveReader(t, entries)); err == nil {
			t.Fatal("invalid archive was accepted")
		}
	}
}

func TestStandardSkillFieldBoundariesAndStringAliases(t *testing.T) {
	raw := "---\nname: " + strings.Repeat("a", 64) + "\ndescription: " + strings.Repeat("中", 1024) + "\ncompatibility: " + strings.Repeat("x", 500) + "\n---\nBody"
	if _, err := parseStandardSkillDocument(raw); err != nil {
		t.Fatal(err)
	}
	raw = "---\nname: review\ndescription: &desc Review videos\nmetadata:\n  purpose: *desc\n---\nBody"
	if _, err := parseStandardSkillDocument(raw); err != nil {
		t.Fatalf("valid string alias was rejected: %v", err)
	}
	raw = "---\nname: review\ndescription: Review\nmetadata: &loop\n  loop: *loop\n---\nBody"
	if _, err := parseStandardSkillDocument(raw); err == nil {
		t.Fatal("recursive metadata was accepted")
	}
}

func TestSkillImportBatchSizeIsNotJustAPerPackageLimit(t *testing.T) {
	a := []AdminSkillFileDTO{{Path: "SKILL.md", Content: standardSkillText("a")}, {Path: "ref.txt", Content: strings.Repeat("a", maxSkillImportFileBytes)}}
	groups := [][]AdminSkillFileDTO{a, a, a, a}
	if err := validateSkillBatchFileSize(groups); err == nil {
		t.Fatal("accepted a batch above 8 MiB")
	}
	groups = groups[:3]
	if err := validateSkillBatchFileSize(groups); err != nil {
		t.Fatal(err)
	}
	packages := make([]AdminSkillPackageDTO, 4)
	for i := range packages {
		packages[i] = AdminSkillPackageDTO{Title: "Skill", AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "text", Files: a}}
	}
	validation, prepared := validateAdminSkillImports(nil, packages, 0)
	if validation.Valid || prepared != nil || !strings.Contains(validation.Items[0].Errors[0], "8 MB") {
		t.Fatalf("validation=%#v", validation)
	}
}

func TestMCPAndOrdinarySkillImportsUseIdenticalFormatRules(t *testing.T) {
	for _, document := range []string{
		"plain instructions", "---\nname: review\n---\nBody", standardSkillText("Bad_Name"), standardSkillText("review"),
	} {
		var ordinaryErrors string
		for _, mcpEnabled := range []bool{false, true} {
			pkg := AdminSkillPackageDTO{Title: "Review", MCPEnabled: mcpEnabled, AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{
				Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "text", OutputTypes: []string{"text"},
				Manifest: json.RawMessage(`{"kind":"agent"}`), PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: document}},
			}}
			result, prepared := validateAdminSkillImports(nil, []AdminSkillPackageDTO{pkg}, 0)
			valid := document == standardSkillText("review")
			if result.Valid != valid {
				t.Fatalf("mcp=%v valid=%v document=%q", mcpEnabled, result.Valid, document)
			}
			if valid {
				if len(prepared) != 1 || prepared[0].Skill.MCPEnabled != mcpEnabled {
					t.Fatal("valid package lost its MCP setting")
				}
			} else if len(prepared) != 0 {
				t.Fatal("invalid package prepared for writing")
			}
			errors := strings.Join(result.Items[0].Errors, "|")
			if !mcpEnabled {
				ordinaryErrors = errors
			} else if errors != ordinaryErrors {
				t.Fatalf("MCP changed format validation: %s / %s", ordinaryErrors, errors)
			}
		}
	}
}

func TestHistoricalInvalidSkillCannotPublishOrCreateByAnotherRoute(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{BaseModel: model.BaseModel{ID: 10}, Title: "Review", Kind: "agent", CurrentVersionID: 11}
	version := model.SkillVersion{BaseModel: model.BaseModel{ID: 12}, SkillID: 10, Version: 2, Kind: "agent", Status: model.SkillVersionDraft,
		EntryPoints: `["canvas"]`, PrimaryOutputType: "text", OutputTypes: `["text"]`, InputSchema: `{"type":"object"}`, ManifestJSON: `{"kind":"agent"}`, PrimaryFilePath: "SKILL.md", PromptTemplate: "plain prompt"}
	file := model.SkillFile{SkillVersionID: 12, Path: "SKILL.md", Content: "plain prompt"}
	for _, row := range []any{&skill, &version, &file} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &skillsHandler{db: db}
	router := gin.New()
	group := router.Group("/skills")
	group.POST("", h.create)
	registerSkillVersionRoutes(group, h)
	for _, mcpEnabled := range []bool{false, true} {
		if err := db.Model(&skill).Update("mcp_enabled", mcpEnabled).Error; err != nil {
			t.Fatal(err)
		}
		createBody, _ := json.Marshal(AdminSkillSaveDTO{Title: "Not a Skill", OutputType: "image", PromptTemplate: "plain prompt", MCPEnabled: &mcpEnabled})
		for _, input := range []struct {
			path string
			body string
		}{
			{"/skills/10/versions/12/publish", `{}`},
			{"/skills/10/versions", `{"kind":"agent","entryPoints":["canvas"],"primaryOutputType":"text","promptTemplate":"plain prompt"}`},
			{"/skills", string(createBody)},
		} {
			out := httptest.NewRecorder()
			req := httptest.NewRequest("POST", input.path, strings.NewReader(input.body))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(out, req)
			if out.Code != 400 || !strings.Contains(out.Body.String(), "格式不符合规范") {
				t.Fatalf("mcp=%v %s accepted non-Skill: %s", mcpEnabled, input.path, out.Body.String())
			}
		}
		var saved model.Skill
		db.First(&saved, "id = ?", 10)
		if saved.CurrentVersionID != 11 {
			t.Fatal("invalid draft replaced published version")
		}
		var count int64
		db.Model(&model.Skill{}).Count(&count)
		if count != 1 {
			t.Fatal("invalid create was not rolled back")
		}
	}
}

func TestStandardSkillCanBeImportedAndPublishedWithOrWithoutMCP(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.SkillSurfaceBinding{}, &model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.MarketModel{Name: "Test text", ModelKey: "skill-test-text", Type: "text", Status: 1, Config: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	h := &skillsHandler{db: db}
	router := gin.New()
	router.POST("/import", h.importSkills)
	for _, mcpEnabled := range []bool{false, true} {
		pkg := AdminSkillPackageDTO{Title: "Review", MCPEnabled: mcpEnabled, InputDescription: " Upload a video ", InputExample: " Review continuity ", OutputExample: " Example review result ", AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{
			Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "text", OutputTypes: []string{"text"},
			Manifest: json.RawMessage(`{"kind":"agent"}`), InputSchema: json.RawMessage(`{"type":"object"}`), DefaultParams: json.RawMessage(`{}`), PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{{Path: "SKILL.md", Content: standardSkillText("review")}}, Publish: true,
		}}
		body, _ := json.Marshal(AdminSkillImportDTO{Skills: []AdminSkillPackageDTO{pkg}})
		out := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/import", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(out, req)
		if out.Code != 200 || !strings.Contains(out.Body.String(), `"success":true`) {
			t.Fatalf("mcp=%v valid import rejected: %s", mcpEnabled, out.Body.String())
		}
		var saved model.Skill
		if err := db.Order("id DESC").First(&saved).Error; err != nil || saved.CurrentVersionID == 0 || saved.MCPEnabled != mcpEnabled {
			t.Fatalf("wrong imported skill: %+v %v", saved, err)
		}
		if saved.InputDescription != "Upload a video" || saved.InputExample != "Review continuity" || saved.OutputExample != "Example review result" {
			t.Fatal("import lost public usage examples")
		}
		var file model.SkillFile
		if err := db.Where("skill_version_id = ?", saved.CurrentVersionID).First(&file).Error; err != nil || file.Content != standardSkillText("review") {
			t.Fatal("imported Skill document was changed")
		}
	}
}
