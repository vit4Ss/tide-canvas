package skill

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/mcpconfig"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/skillformat"
)

func libraryTestServer(t *testing.T) (*gorm.DB, *gin.Engine) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.MCPSettings{}); err != nil {
		t.Fatal(err)
	}
	settings := mcpconfig.Defaults()
	settings.PublicURL = "https://flowlight.example/mcp"
	if _, err := mcpconfig.Save(context.Background(), db, settings, 0); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		id := idgen.ID(100 + i)
		row := model.Skill{BaseModel: model.BaseModel{ID: id}, Title: "视频审片", Description: "分析镜头连续性", Category: "专业影视", Kind: "agent", OutputType: "text", Status: 1, MCPEnabled: i != 2,
			CurrentVersionID: id + 100, PromptTemplate: "original-private-prompt", DefaultParams: `{"apiKey":"private-provider-key"}`, ModelID: "private-model", UseCount: int64(i)}
		if i == 2 {
			row.Category = "办公文档"
			row.Title = "文档整理"
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if i == 3 {
			if err := db.Model(&row).Update("status", 0).Error; err != nil {
				t.Fatal(err)
			}
		}
		version := model.SkillVersion{BaseModel: model.BaseModel{ID: id + 100}, SkillID: id, Version: 2, Kind: "agent", Status: model.SkillVersionPublished,
			PrimaryFilePath: "review/SKILL.md", PrimaryOutputType: "text", OutputTypes: `["text"]`, EntryPoints: `["canvas"]`, InputSchema: `{"type":"object","properties":{"prompt":{"type":"string","description":"用户需求"}}}`, ManifestJSON: `{"secret":"private-manifest"}`, PromptTemplate: "private-version-prompt"}
		if i == 4 {
			version.Status = model.SkillVersionDraft
		}
		if err := db.Create(&version).Error; err != nil {
			t.Fatal(err)
		}
		document := "---\nname: review\ndescription: Original private description\n---\n\noriginal-private-source"
		if i == 5 {
			document = "invalid old instructions"
		}
		for _, file := range []model.SkillFile{{SkillVersionID: version.ID, Path: "review/SKILL.md", Content: document}, {SkillVersionID: version.ID, Path: "review/references/rules.md", Content: "private-reference"}} {
			if err := db.Create(&file).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	router := gin.New()
	(&libraryHandler{db: db}).routes(router.Group("/api/skill-library"))
	return db, router
}

func libraryRequest(router *gin.Engine, path string) *httptest.ResponseRecorder {
	out := httptest.NewRecorder()
	router.ServeHTTP(out, httptest.NewRequest("GET", path, nil))
	return out
}

func TestPublicLibraryListsPublishedSkillsWithoutPrivateSources(t *testing.T) {
	_, router := libraryTestServer(t)
	out := libraryRequest(router, "/api/skill-library?pageSize=2")
	var result response.Result[struct {
		response.PageData[librarySkillVO]
		Categories []string `json:"categories"`
	}]
	if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success || result.Data.Total != 2 || len(result.Data.Records) != 2 || len(result.Data.Categories) != 1 {
		t.Fatalf("list=%s err=%v", out.Body.String(), err)
	}
	for _, path := range []string{"/api/skill-library", "/api/skill-library/101"} {
		out := libraryRequest(router, path)
		if out.Code != 200 || strings.Contains(out.Body.String(), "private-") || strings.Contains(out.Body.String(), "promptTemplate") || strings.Contains(out.Body.String(), "defaultParams") {
			t.Fatalf("public metadata exposed private source: %s", out.Body.String())
		}
	}
	out = libraryRequest(router, "/api/skill-library?category=办公文档&keyword=整理")
	if !strings.Contains(out.Body.String(), `"total":0`) || strings.Contains(out.Body.String(), `"id":"102"`) {
		t.Fatalf("filters=%s", out.Body.String())
	}
	out = libraryRequest(router, "/api/skill-library?category=专业影视&keyword=审片")
	if !strings.Contains(out.Body.String(), `"total":2`) {
		t.Fatalf("enabled skills missing from filters: %s", out.Body.String())
	}
	for _, id := range []string{"102", "103", "104", "999", "not-an-id"} {
		if out := libraryRequest(router, "/api/skill-library/"+id); out.Code != 404 {
			t.Fatalf("unpublished skill visible: %s %s", id, out.Body.String())
		}
	}
}

func TestPublicSkillLinkAndZIPOnlyDistributeValidatedWrapper(t *testing.T) {
	_, router := libraryTestServer(t)
	out := libraryRequest(router, "/api/skill-library/101/SKILL.md")
	if out.Code != 200 || out.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(out.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("document=%d %s", out.Code, out.Body.String())
	}
	document := out.Body.String()
	meta, err := skillformat.ParseDocument(document)
	if err != nil || meta.Name != "flowlight-skill-101" {
		t.Fatalf("invalid public Skill: %+v %v", meta, err)
	}
	for _, required := range []string{"https://flowlight.example/mcp/skills/101", "get_skill_info", "run_skill", "get_skill_run", "respond_skill_run", "FLOWLIGHT_API_KEY", "clientRequestId", "expectedRevision", "references/connection.json", "metadataUrl", "不要为验证安装而调用 run_skill"} {
		if !strings.Contains(document, required) {
			t.Fatalf("wrapper missing %s", required)
		}
	}
	for _, forbidden := range []string{"private-", "original-private-source", "private-provider-key"} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("wrapper exposes source: %s", forbidden)
		}
	}
	for _, required := range []string{"## 自动接入 MCP", "每次使用本 Skill", "codex mcp get flowlight_skill_101 --json", "codex mcp add flowlight_skill_101 --url", "mcp_servers.flowlight_skill_101", "配置存在且地址一致则复用", "显式停用", "自动修复最多一次", "需重新连接或开启新会话", "本次安装指令明确提供的新密钥 > 本技能已有的本地鉴权 > FLOWLIGHT_API_KEY", "已有有效鉴权时保留原配置"} {
		if !strings.Contains(document, required) {
			t.Fatalf("public Skill cannot bootstrap its MCP: missing %s", required)
		}
	}
	out = libraryRequest(router, "/api/skill-library/101/download")
	if out.Code != 200 || !strings.Contains(out.Header().Get("Content-Disposition"), "flowlight-skill-101.zip") {
		t.Fatal("ZIP response is not an attachment")
	}
	archive, err := zip.NewReader(bytes.NewReader(out.Body.Bytes()), int64(out.Body.Len()))
	if err != nil || len(archive.File) != 1 || archive.File[0].Name != "flowlight-skill-101/SKILL.md" {
		t.Fatalf("unsafe ZIP: %+v %v", archive, err)
	}
	reader, _ := archive.File[0].Open()
	data, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil || string(data) != document {
		t.Fatal("ZIP differs from public wrapper")
	}
	if _, err := skillformat.ValidateFiles([]skillformat.File{{Path: archive.File[0].Name, Content: string(data)}}, archive.File[0].Name, ""); err != nil {
		t.Fatal(err)
	}
}

func TestSkillInstallationFailsClosedForDisabledOrInvalidPackages(t *testing.T) {
	db, router := libraryTestServer(t)
	for _, id := range []string{"102", "105"} {
		wantStatus := 409
		if id == "102" {
			wantStatus = 404
		}
		for _, suffix := range []string{"/SKILL.md", "/download"} {
			if out := libraryRequest(router, "/api/skill-library/"+id+suffix); out.Code != wantStatus {
				t.Fatalf("unavailable package exported: %s", out.Body.String())
			}
		}
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("mcp_enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if libraryRequest(router, "/api/skill-library/101/SKILL.md").Code != 404 {
		t.Fatal("disabled MCP link remained downloadable")
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", 101).Updates(map[string]any{"mcp_enabled": true, "status": 0}).Error; err != nil {
		t.Fatal(err)
	}
	if libraryRequest(router, "/api/skill-library/101/SKILL.md").Code != 404 {
		t.Fatal("offline Skill source available")
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("status", 1).Error; err != nil {
		t.Fatal(err)
	}
	settings := mcpconfig.Defaults()
	settings.PublicURL = "https://flowlight.example/mcp"
	settings.Enabled = false
	if _, err := mcpconfig.Save(context.Background(), db, settings, 1); err != nil {
		t.Fatal(err)
	}
	if libraryRequest(router, "/api/skill-library/101/download").Code != 200 {
		t.Fatal("disabled MCP execution must not block installing an exposed Skill")
	}
	assertInstallableWithoutMCP(t, router, "调用暂时关闭")
	settings.Enabled = true
	settings.PublicURL = ""
	if _, err := mcpconfig.Save(context.Background(), db, settings, 2); err != nil {
		t.Fatal(err)
	}
	assertInstallableWithoutMCP(t, router, "地址尚未配置")
	out := libraryRequest(router, "/api/skill-library/101/SKILL.md")
	if out.Code != 200 || strings.Contains(out.Body.String(), "localhost") || strings.Contains(out.Body.String(), `url = ""`) || !strings.Contains(out.Body.String(), "metadataUrl") {
		t.Fatalf("missing configuration generated an unusable or guessed MCP URL: %s", out.Body.String())
	}
	if _, err := skillformat.ParseDocument(out.Body.String()); err != nil {
		t.Fatalf("deferred-connection Skill is not standard: %v", err)
	}
}

func assertInstallableWithoutMCP(t *testing.T, router *gin.Engine, reason string) {
	t.Helper()
	out := libraryRequest(router, "/api/skill-library/101")
	var result response.Result[librarySkillVO]
	if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success || !result.Data.Installable || result.Data.MCPAvailable || result.Data.InstallPath == "" || result.Data.DownloadPath == "" || !strings.Contains(result.Data.MCPUnavailableReason, reason) || result.Data.UnavailableReason != "" {
		t.Fatalf("installation was confused with execution: %s", out.Body.String())
	}
}

func TestMCPConfigurationReadFailureDoesNotHideSkillInstallation(t *testing.T) {
	db, router := libraryTestServer(t)
	if err := db.Migrator().DropTable(&model.MCPSettings{}); err != nil {
		t.Fatal(err)
	}
	assertInstallableWithoutMCP(t, router, "配置暂时无法读取")
	if out := libraryRequest(router, "/api/skill-library/101/SKILL.md"); out.Code != 200 || strings.Contains(out.Body.String(), "private-") {
		t.Fatalf("unavailable MCP configuration blocked safe public instructions: %s", out.Body.String())
	}
}

func TestLibraryDoesNotAdvertiseDisabledNativePlacements(t *testing.T) {
	db, router := libraryTestServer(t)
	if err := db.Model(&model.SkillVersion{}).Where("id IN ?", []int{201, 202}).Update("bindings_json", `[{"surface":"canvas","targetType":"*","enabled":false}]`).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"101"} {
		out := libraryRequest(router, "/api/skill-library/"+id)
		var result response.Result[librarySkillVO]
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success || result.Data.NativePath != "" || result.Data.Installable != (id == "101") {
			t.Fatalf("disabled native placement/MCP independence: %s", out.Body.String())
		}
	}
}

func TestExposureControlsAllLibraryRoutesAndCategories(t *testing.T) {
	db, router := libraryTestServer(t)
	for _, enabled := range []bool{false, true, false} {
		if err := db.Model(&model.Skill{}).Where("id = ?", 102).Update("mcp_enabled", enabled).Error; err != nil {
			t.Fatal(err)
		}
		for _, suffix := range []string{"", "/SKILL.md", "/download"} {
			out := libraryRequest(router, "/api/skill-library/102"+suffix)
			want := 404
			if enabled {
				want = 200
			}
			if out.Code != want || out.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("enabled=%v suffix=%s status=%d body=%s", enabled, suffix, out.Code, out.Body.String())
			}
		}
		out := libraryRequest(router, "/api/skill-library")
		var result response.Result[struct {
			response.PageData[librarySkillVO]
			Categories []string `json:"categories"`
		}]
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success {
			t.Fatalf("list: %s", out.Body.String())
		}
		wantTotal := int64(2)
		if enabled {
			wantTotal = 3
		}
		if result.Data.Total != wantTotal || strings.Contains(out.Body.String(), "办公文档") != enabled || strings.Contains(out.Body.String(), `"id":"102"`) != enabled {
			t.Fatalf("exposure leaked into total/records/categories: %s", out.Body.String())
		}
	}
}

func TestHiddenLibrarySkillRemainsAvailableOnItsNativeSurface(t *testing.T) {
	db, router := libraryTestServer(t)
	if err := db.AutoMigrate(&model.SkillSurfaceBinding{}); err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	router.GET("/api/skills", h.list)
	router.GET("/api/skills/:id", h.get)
	for _, path := range []string{"/api/skills?entryPoint=canvas", "/api/skills/102?entryPoint=canvas"} {
		out := libraryRequest(router, path)
		if out.Code != 200 || !strings.Contains(out.Body.String(), `"id":"102"`) || strings.Contains(out.Body.String(), "private-") {
			t.Fatalf("native Skill disappeared or leaked private content: %s", out.Body.String())
		}
	}
	if out := libraryRequest(router, "/api/skill-library/102"); out.Code != 404 {
		t.Fatalf("native surface exposed hidden install page: %s", out.Body.String())
	}
}
