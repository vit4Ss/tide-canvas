package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/model"
)

func TestGPTDraftSourceRequiresAdaptationBeforeVersionCreation(t *testing.T) {
	original := "GPT 帮我写的技能：用外部图片接口生成场景，再运行 Python 拼接视频。"
	pkg, err := prepareSkillDraftText(original)
	if err != nil {
		t.Fatal(err)
	}
	if len(pkg.Files) != 2 || pkg.Files[1].Content != original || !isSkillDraftSource(pkg.Files[0].Content) {
		t.Fatal("原文未被保留为草稿资料")
	}
	if _, err := validateStandardSkillPackage(pkg.Files, pkg.PrimaryFilePath); err != nil {
		t.Fatal(err)
	}
	dto := AdminSkillVersionCreateDTO{Kind: "agent", EntryPoints: []string{"canvas"}, PrimaryOutputType: "text", OutputTypes: []string{"text"}, PrimaryFilePath: pkg.PrimaryFilePath, Files: pkg.Files}
	skill := &model.Skill{Kind: "agent", OutputType: "text"}
	if _, _, err := buildSkillVersion(nil, skill, dto, 1); err == nil || !strings.Contains(err.Error(), "草稿") {
		t.Fatal("草稿被当成运行版本", err)
	}
	preview := skillAdaptationPreviewDTO{AdminSkillImportSource: AdminSkillImportSource{PrimaryFilePath: pkg.PrimaryFilePath, Files: pkg.Files, Report: SkillAdaptationReport{Status: "partial", Summary: "保留场景规划，去掉脚本执行", Removed: []SkillAdaptationRemoval{{Feature: "视频拼接", Reason: "未接入"}}}}, Description: "场景规划助手", Instructions: "# 场景规划\n根据用户要求给出场景规划。不运行外部命令。"}
	files, err := prepareSkillAdaptation(preview)
	if err != nil {
		t.Fatal(err)
	}
	if isSkillDraftSource(files[0].Content) {
		t.Fatal("新执行正文仍带草稿标记")
	}
	preview.Reviewed = true
	dto.Files, dto.PrimaryFilePath, dto.ImportSource = files, "SKILL.md", &preview.AdminSkillImportSource
	version, runtimeFiles, err := buildSkillVersion(nil, skill, dto, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(runtimeFiles) != 1 || strings.Contains(version.PromptTemplate, "Python") || !strings.Contains(version.ImportSourceJSON, "Python") {
		t.Fatal("原文未与运行时隔离")
	}
}

func TestGPTDraftDoesNotRelaxStrictFileImportAndRetainsValidDocument(t *testing.T) {
	plain := "# GPT 回答\n请帮用户处理内容。"
	if _, err := validateStandardSkillPackage([]AdminSkillFileDTO{{Path: "SKILL.md", Content: plain}}, "SKILL.md"); err == nil {
		t.Fatal("普通文件绕过标准导入")
	}
	document := "---\nname: review\ndescription: Review videos\nlicense: MIT\n---\n# Review\nKeep the original rules."
	pkg, err := prepareSkillDraftText(document)
	if err != nil || len(pkg.Files) != 1 || pkg.Files[0].Content != document {
		t.Fatalf("合规文档被错误重写: %v", err)
	}
	for _, raw := range []string{"", " \n ", "x\x00y", string([]byte{0xff}), strings.Repeat("中", 100001)} {
		if _, err := prepareSkillDraftText(raw); err == nil {
			t.Fatal("无效草稿被接受")
		}
	}
}

func TestGPTDraftEndpointRejectsExtraFieldsAndDoesNotWriteDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{`{"text":"帮我改写文案"}`, `{"text":"draft","publish":true}`, `{"text":"draft"} {}`, strings.Repeat("x", (1<<20)+1)} {
		out := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(out)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/admin/skills/draft-source", strings.NewReader(body))
		(&skillsHandler{}).prepareSkillDraftSource(c)
		var result struct {
			Success bool                     `json:"success"`
			Data    AdminSkillFilePackageDTO `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Success != (body == `{"text":"帮我改写文案"}`) {
			t.Fatal(out.Body.String())
		}
	}
}
