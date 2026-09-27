package admin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const githubTestSHA = "1234567890abcdef1234567890abcdef12345678"

type skillGitHubTransport func(*http.Request) (*http.Response, error)

func (f skillGitHubTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func githubReply(status int, body []byte) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}
}

func TestSkillGitHubSourceLinks(t *testing.T) {
	for _, raw := range []string{
		"https://github.com/team/review", " https://github.com/team/review.git/ ",
		"https://github.com/team/skills/tree/main/review", "https://github.com/team/skills/blob/main/review/SKILL.md?plain=1#review",
		"https://raw.githubusercontent.com/team/skills/main/review/SKILL.md",
		"https://github.com/team/skills/tree/feature/review/review",
	} {
		if _, err := parseSkillGitHubSource(raw); err != nil {
			t.Errorf("%s: %v", raw, err)
		}
	}
	for _, raw := range []string{
		"http://github.com/a/b", "https://github.com.evil.test/a/b", "https://github.com:443/a/b",
		"https://token@github.com/a/b", "https://127.0.0.1/a/b", "file:///tmp/SKILL.md",
		"https://github.com/a/b/issues/1", "https://github.com/a/b/blob/main/readme.md", "https://github.com/a/b/tree",
		"https://github.com/a/b/tree/main/%2e%2e/c", "https://github.com/a/b/tree/main/%5cc",
		"https://github.com/a/.git", "https://github.com/a/b/tree/main/refs%00x",
	} {
		if _, err := parseSkillGitHubSource(raw); err == nil {
			t.Errorf("accepted unsafe/unsupported URL %s", raw)
		}
	}
}

func TestGitHubImportPinsDefaultBranchAndUsesTheExistingValidator(t *testing.T) {
	content := "---\nname: video-review\ndescription: Review videos\n---\nReview the video."
	data := archiveData(t, []struct{ name, content string }{
		{"repo-random/SKILL.md", content}, {"repo-random/references/checks.md", "Check continuity"},
		{"repo-random/scripts/run.py", "do not execute"},
	})
	var calls []string
	client := &http.Client{Transport: skillGitHubTransport(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.URL.String())
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Fatal("forwarded credentials")
		}
		if r.URL.Host == "api.github.com" && r.URL.Path == "/repos/team/repo/commits/HEAD" {
			return githubReply(200, []byte(`{"sha":"`+githubTestSHA+`"}`)), nil
		}
		if r.URL.String() != "https://codeload.github.com/team/repo/zip/"+githubTestSHA {
			t.Fatalf("unexpected URL %s", r.URL)
		}
		return githubReply(200, data), nil
	})}
	preview, err := loadSkillGitHub(context.Background(), client, "https://github.com/team/repo")
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || preview.CommitSHA != githubTestSHA || len(preview.Packages) != 1 || preview.IgnoredFiles != 1 {
		t.Fatalf("preview=%+v calls=%v", preview, calls)
	}
	pkg := preview.Packages[0]
	if len(pkg.Files) != 2 || pkg.Files[0].Path != "SKILL.md" || pkg.Files[0].Content != content {
		t.Fatalf("package changed: %+v", pkg)
	}
	if _, err := validateStandardSkillPackage(pkg.Files, pkg.PrimaryFilePath); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubImportFindsSlashBranchAndOnlySelectedDirectory(t *testing.T) {
	data := archiveData(t, []struct{ name, content string }{
		{"repo-sha/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody"},
		{"repo-sha/skills/review/references/a.md", "ref"},
		{"repo-sha/skills/review-other/SKILL.md", "Not a valid Skill outside requested scope"},
	})
	client := &http.Client{Transport: skillGitHubTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "codeload.github.com" {
			return githubReply(200, data), nil
		}
		if strings.TrimPrefix(r.URL.Path, "/repos/team/repo/commits/") == "feature/rework" {
			return githubReply(200, []byte(`{"sha":"`+githubTestSHA+`"}`)), nil
		}
		return githubReply(404, nil), nil
	})}
	for _, raw := range []string{
		"https://github.com/team/repo/tree/feature/rework/skills/review",
		"https://github.com/team/repo/blob/feature/rework/skills/review/SKILL.md",
		"https://raw.githubusercontent.com/team/repo/feature/rework/skills/review/SKILL.md",
	} {
		preview, err := loadSkillGitHub(context.Background(), client, raw)
		if err != nil {
			t.Fatal(raw, err)
		}
		if preview.Directory != "skills/review" || len(preview.Packages) != 1 || preview.Packages[0].Root != "review" || len(preview.Packages[0].Files) != 2 {
			t.Fatalf("wrong scope: %+v", preview)
		}
	}
}

func TestGitHubImportKeepsFormatAndArchiveSafety(t *testing.T) {
	cases := []struct {
		name, directory string
		entries         []struct{ name, content string }
	}{
		{"plain text", "", []struct{ name, content string }{{"repo-sha/SKILL.md", "# Not a Skill"}}},
		{"directory name mismatch", "wrong", []struct{ name, content string }{{"repo-sha/wrong/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody"}}},
		{"missing directory", "missing", []struct{ name, content string }{{"repo-sha/readme.md", "readme"}}},
		{"path traversal", "", []struct{ name, content string }{{"../SKILL.md", "bad"}}},
		{"multiple wrappers", "", []struct{ name, content string }{{"one/a.md", "a"}, {"two/b.md", "b"}}},
		{"duplicate", "", []struct{ name, content string }{{"root/SKILL.md", "a"}, {"root/SKILL.md", "b"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := inspectSkillGitHubArchive(archiveReader(t, tc.entries), tc.directory); err == nil {
				t.Fatal("unsafe archive accepted")
			}
		})
	}
	// Non-selected files must not exhaust the per-package entry limit.
	entries := []struct{ name, content string }{{"r/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody"}}
	for i := 0; i < 600; i++ {
		entries = append(entries, struct{ name, content string }{fmt.Sprintf("r/ignored/file-%d.txt", i), "ignored"})
	}
	if _, err := inspectSkillGitHubArchive(archiveReader(t, entries), "review"); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubReadRejectsRedirectsErrorsOversizeAndCancel(t *testing.T) {
	for _, raw := range []string{"http://api.github.com/x", "https://127.0.0.1/x", "https://github.com/x", "https://evil.test/x", "https://api.github.com:443/x"} {
		u, _ := url.Parse(raw)
		if err := skillGitHubDownloadURL(u); err == nil {
			t.Fatal("redirect allowed", raw)
		}
	}
	for _, status := range []int{401, 403, 404, 429, 500} {
		calls := 0
		client := &http.Client{Transport: skillGitHubTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			return githubReply(status, []byte("private diagnostic")), nil
		})}
		_, err := loadSkillGitHub(context.Background(), client, "https://github.com/a/b")
		if err == nil || calls != 1 || strings.Contains(err.Error(), "private diagnostic") {
			t.Fatalf("status=%d calls=%d err=%v", status, calls, err)
		}
	}
	client := &http.Client{Transport: skillGitHubTransport(func(r *http.Request) (*http.Response, error) {
		out := githubReply(200, []byte("too much"))
		out.ContentLength = -1
		return out, nil
	})}
	if _, err := readSkillGitHubURL(context.Background(), client, "https://api.github.com/x", 4); err == nil {
		t.Fatal("unbounded chunked response")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client.Transport = skillGitHubTransport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	if _, err := loadSkillGitHub(ctx, client, "https://github.com/a/b"); err == nil || !strings.Contains(err.Error(), "取消") {
		t.Fatal(err)
	}
}

func TestGitHubPreviewRejectsMalformedRequestsBeforeNetwork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{`{"url":"https://evil.test/a/b"}`, `{"url":"https://github.com/a/b","token":"never-forward"}`, `{} {}`, strings.Repeat("x", 5000)} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/admin/skills/github-preview", strings.NewReader(body))
		(&skillsHandler{}).previewGitHubSkill(ctx)
		var result struct {
			Success bool `json:"success"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Success {
			t.Fatal(recorder.Body.String())
		}
	}
}

func TestGitHubArchiveDoesNotReadSymlink(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	hdr := &zip.FileHeader{Name: "root/review/SKILL.md", ExternalAttrs: (0120777 << 16), CreatorVersion: 3 << 8}
	f, _ := w.CreateHeader(hdr)
	_, _ = f.Write([]byte("../secret"))
	_ = w.Close()
	r, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if _, err := inspectSkillGitHubArchive(r, "review"); err == nil || !strings.Contains(err.Error(), "符号链接") {
		t.Fatal(err)
	}
}

func TestGitHubCommitNeedsValidSHA(t *testing.T) {
	client := &http.Client{Transport: skillGitHubTransport(func(*http.Request) (*http.Response, error) { return githubReply(200, []byte(`{"sha":"../../x"}`)), nil })}
	_, err := loadSkillGitHub(context.Background(), client, "https://github.com/a/b")
	var httpErr *skillGitHubHTTPError
	if err == nil || errors.As(err, &httpErr) {
		t.Fatal(err)
	}
}

// Optional public-network smoke check; ordinary unit tests are fully offline.
func TestGitHubPublicSkillLive(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("SKILL_GITHUB_TEST_URL"))
	if raw == "" {
		t.Skip("set SKILL_GITHUB_TEST_URL to verify a public GitHub Skill")
	}
	ctx, cancel := context.WithTimeout(context.Background(), skillGitHubTimeout)
	defer cancel()
	preview, err := loadSkillGitHub(ctx, skillGitHubClient, raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Packages) == 0 {
		t.Fatal("empty Skill preview")
	}
	t.Logf("public GitHub preview: %d packages at %s", len(preview.Packages), preview.CommitSHA)
}
