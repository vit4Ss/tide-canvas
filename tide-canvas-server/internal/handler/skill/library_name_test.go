package skill

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"strings"
	"testing"
	"unicode/utf8"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/skillformat"
)

func TestLibraryInstallNameUsesTitleAcrossMetadataDocumentAndZIP(t *testing.T) {
	db, router := libraryTestServer(t)
	for _, tc := range []struct{ title, name string }{
		{"ai-director-video-review", "ai-director-video-review"},
		{"AI Director Video Review", "ai-director-video-review"},
		{"审片 Skill（专业版）", "审片-skill-专业版"},
		{"../A_B\\C: D\r\nE", "a-b-c-d-e"},
		{strings.Repeat("审", 70), strings.Repeat("审", 64)},
		{"   ", "review"},
		{"🔥✨", "review"},
		{"CON", "con-skill"},
		{"42", "42"},
		{"true", "true"},
		{"null", "null"},
	} {
		t.Run(tc.title, func(t *testing.T) {
			if err := db.Model(&model.Skill{}).Where("id = ?", 101).Update("title", tc.title).Error; err != nil {
				t.Fatal(err)
			}
			out := libraryRequest(router, "/api/skill-library/101")
			var result response.Result[librarySkillVO]
			if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil || !result.Success || result.Data.SkillName != tc.name || result.Data.Title != tc.title {
				t.Fatalf("wrong public name: %s", out.Body.String())
			}
			if result.Data.MCPEndpoint != "https://flowlight.example/mcp/skills/101" {
				t.Fatal("renaming changed the MCP identity")
			}
			document := libraryRequest(router, "/api/skill-library/101/SKILL.md")
			meta, err := skillformat.ParseDocument(document.Body.String())
			if document.Code != 200 || err != nil || meta.Name != tc.name || utf8.RuneCountInString(meta.Name) > 64 {
				t.Fatalf("invalid exported name: status=%d err=%v body=%s", document.Code, err, document.Body.String())
			}
			if strings.Contains(document.Body.String(), "original-private-source") || !strings.Contains(document.Body.String(), "flowlight_skill_101") {
				t.Fatal("wrapper source or MCP binding changed")
			}
			zipped := libraryRequest(router, "/api/skill-library/101/download")
			_, params, err := mime.ParseMediaType(zipped.Header().Get("Content-Disposition"))
			if err != nil || params["filename"] != tc.name+".zip" {
				t.Fatalf("invalid download filename: %v %v", params, err)
			}
			z, err := zip.NewReader(bytes.NewReader(zipped.Body.Bytes()), int64(zipped.Body.Len()))
			if err != nil || len(z.File) != 1 || z.File[0].Name != tc.name+"/SKILL.md" {
				t.Fatalf("invalid package: %v %v", z, err)
			}
			r, err := z.File[0].Open()
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(r)
			_ = r.Close()
			if err != nil || !bytes.Equal(body, document.Body.Bytes()) {
				t.Fatal("ZIP document differs from raw document")
			}
			if _, err := skillformat.ValidateFiles([]skillformat.File{{Path: z.File[0].Name, Content: string(body)}}, z.File[0].Name, ""); err != nil {
				t.Fatal(err)
			}
		})
	}
	var original model.SkillFile
	if err := db.Where("skill_version_id = ? AND path = ?", 201, "review/SKILL.md").First(&original).Error; err != nil || !strings.Contains(original.Content, "name: review") {
		t.Fatal("private version was changed by public naming")
	}
}

func TestLibraryWrapperProtectsExistingLocalSkillsDuringNameMigration(t *testing.T) {
	_, router := libraryTestServer(t)
	doc := libraryRequest(router, "/api/skill-library/101/SKILL.md").Body.String()
	for _, required := range []string{"不同来源", "不得覆盖", "flowlight-skill-101", "技能扫描目录之外", "同一源站", "skill-id"} {
		if !strings.Contains(doc, required) {
			t.Fatalf("migration guidance missing %q", required)
		}
	}
}
