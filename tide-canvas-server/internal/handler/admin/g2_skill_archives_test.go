package admin

import (
	"archive/zip"
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
)

func archiveData(t *testing.T, entries []struct{ name, content string }) []byte {
	t.Helper()
	var encoded bytes.Buffer
	writer := zip.NewWriter(&encoded)
	for _, entry := range entries {
		file, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(entry.content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func archiveReader(t *testing.T, entries []struct{ name, content string }) *zip.Reader {
	t.Helper()
	data := archiveData(t, entries)
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func TestPreviewSkillArchiveAcceptsMultipartZIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	data := archiveData(t, []struct{ name, content string }{
		{"bundle/review/SKILL.md", "# Review"},
		{"bundle/review/references/rules.md", "rules"},
		{"bundle/review/scripts/run.py", "print('ignored')"},
	})
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "review.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/admin/skills/archive-preview", &body)
	ctx.Request.Header.Set("Content-Type", form.FormDataContentType())
	(&skillsHandler{}).previewSkillArchive(ctx)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"success":true`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"path":"SKILL.md"`) || !strings.Contains(recorder.Body.String(), `"ignoredFiles":1`) {
		t.Fatalf("unexpected preview body: %s", recorder.Body.String())
	}
}

func TestInspectSkillArchiveFindsNestedPackageAndIgnoresExecutableFiles(t *testing.T) {
	reader := archiveReader(t, []struct{ name, content string }{
		{"release/skill/SKILL.md", "---\nname: review\n---\n# Review"},
		{"release/skill/references/rules.md", "rules"},
		{"release/skill/references/notes.txt", "notes"},
		{"release/skill/scripts/run.py", "print('never execute')"},
		{"release/skill/agents/openai.yaml", "interface: {}"},
		{"release/INSTALL.md", "outside package"},
	})
	preview, err := inspectSkillArchive(reader)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Packages) != 1 || preview.Packages[0].Root != "skill" {
		t.Fatalf("packages = %#v", preview.Packages)
	}
	pkg := preview.Packages[0]
	if pkg.PrimaryFilePath != "SKILL.md" || len(pkg.Files) != 3 {
		t.Fatalf("package = %#v", pkg)
	}
	for _, file := range pkg.Files {
		if strings.Contains(file.Path, "release/") || strings.HasSuffix(file.Path, ".py") || strings.HasSuffix(file.Path, ".yaml") {
			t.Fatalf("unsafe or unnormalized file escaped preview: %#v", file)
		}
	}
	if preview.IgnoredFiles != 3 {
		t.Fatalf("ignored files = %d, want 3", preview.IgnoredFiles)
	}
}

func TestInspectSkillArchiveSupportsSeveralIndependentSkills(t *testing.T) {
	reader := archiveReader(t, []struct{ name, content string }{
		{"bundle/a/SKILL.md", "# A"},
		{"bundle/a/ref.md", "A ref"},
		{"bundle/b/SKILL.md", "# B"},
		{"bundle/b/ref.md", "B ref"},
	})
	preview, err := inspectSkillArchive(reader)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Packages) != 2 || preview.Packages[0].Root != "a" || preview.Packages[1].Root != "b" {
		t.Fatalf("packages = %#v", preview.Packages)
	}
	for _, pkg := range preview.Packages {
		if len(pkg.Files) != 2 || pkg.Files[0].Path != "SKILL.md" {
			t.Fatalf("package files = %#v", pkg.Files)
		}
	}
}

func TestArchivePreviewPackagePassesTheFinalImportValidation(t *testing.T) {
	preview, err := inspectSkillArchive(archiveReader(t, []struct{ name, content string }{
		{"release/director/SKILL.md", "---\nname: director-review\ndescription: Review videos\n---\n# Director Review"},
		{"release/director/references/rules.md", "Cite visible evidence."},
		{"release/director/references/output.md", "Return the decision first."},
		{"release/director/scripts/review.py", "print('not executed')"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	archivePackage := preview.Packages[0]
	result, prepared := validateAdminSkillImports(nil, []AdminSkillPackageDTO{{
		Title: "导演审片", AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{
			Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
			PrimaryOutputType: "text", OutputTypes: []string{"text"},
			PrimaryFilePath: archivePackage.PrimaryFilePath, Files: archivePackage.Files,
		},
	}}, 0)
	if !result.Valid || len(prepared) != 1 {
		t.Fatalf("archive preview could not be imported: result=%#v prepared=%#v", result, prepared)
	}
	if !strings.Contains(prepared[0].Version.PromptTemplate, "{{skill.file:references/rules.md}}") || preview.IgnoredFiles != 1 {
		t.Fatalf("package references or ignored-file accounting was lost: prompt=%s ignored=%d", prepared[0].Version.PromptTemplate, preview.IgnoredFiles)
	}
}

func TestExternalSkillArchivePassesPreviewAndStructuralImportValidation(t *testing.T) {
	archivePath := strings.TrimSpace(os.Getenv("SKILL_ARCHIVE_TEST_PATH"))
	if archivePath == "" {
		t.Skip("set SKILL_ARCHIVE_TEST_PATH to validate a real .zip/.skill package")
	}
	file, err := os.Open(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		t.Fatalf("archive is not a valid ZIP: %v", err)
	}
	preview, err := inspectSkillArchive(reader)
	if err != nil {
		t.Fatal(err)
	}
	packages := make([]AdminSkillPackageDTO, 0, len(preview.Packages))
	for index := range preview.Packages {
		archivePackage := preview.Packages[index]
		packages = append(packages, AdminSkillPackageDTO{
			Title: fmt.Sprintf("External Skill %d", index+1),
			AdminSkillVersionCreateDTO: AdminSkillVersionCreateDTO{
				Kind: model.SkillKindAgent, EntryPoints: []string{"canvas"},
				PrimaryOutputType: "text", OutputTypes: []string{"text"},
				PrimaryFilePath: archivePackage.PrimaryFilePath, Files: archivePackage.Files,
			},
		})
	}
	result, prepared := validateAdminSkillImports(nil, packages, 0)
	if !result.Valid || len(prepared) != len(packages) {
		t.Fatalf("archive preview failed structural import validation: result=%#v prepared=%d", result, len(prepared))
	}
}

func TestInspectSkillArchiveRejectsUnsafeOrInvalidPackages(t *testing.T) {
	tests := []struct {
		name    string
		entries []struct{ name, content string }
		want    string
	}{
		{name: "missing primary", entries: []struct{ name, content string }{{"skill/readme.md", "hello"}}, want: "没有找到 SKILL.md"},
		{name: "path traversal", entries: []struct{ name, content string }{{"../SKILL.md", "bad"}}, want: "不安全"},
		{name: "duplicate path", entries: []struct{ name, content string }{{"skill/SKILL.md", "one"}, {"skill/skill.md", "two"}}, want: "重复路径"},
		{name: "oversized primary", entries: []struct{ name, content string }{{"skill/SKILL.md", strings.Repeat("a", maxSkillExecutablePromptBytes+1)}}, want: "1 MB"},
		{name: "oversized text", entries: []struct{ name, content string }{{"skill/SKILL.md", strings.Repeat("a", maxSkillImportFileBytes+1)}}, want: "2 MB"},
		{name: "invalid utf8", entries: []struct{ name, content string }{{"skill/SKILL.md", string([]byte{0xff, 0xfe})}}, want: "UTF-8"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := inspectSkillArchive(archiveReader(t, tc.entries))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestInspectSkillArchiveRejectsTooManyTextFilesPerSkill(t *testing.T) {
	entries := []struct{ name, content string }{{"skill/SKILL.md", "# Skill"}}
	for index := 0; index < maxSkillImportFiles; index++ {
		entries = append(entries, struct{ name, content string }{
			name: fmt.Sprintf("skill/references/%03d.md", index), content: "reference",
		})
	}
	_, err := inspectSkillArchive(archiveReader(t, entries))
	if err == nil || !strings.Contains(err.Error(), "最多包含 128 个文本文件") {
		t.Fatalf("error = %v", err)
	}
}
