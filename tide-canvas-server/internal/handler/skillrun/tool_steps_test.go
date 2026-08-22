package skillrun

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"golang.org/x/net/html"

	"tidecanvas/internal/model"
)

func TestRenderToolFileProducesOfficeAndMarkdownFiles(t *testing.T) {
	cases := []struct {
		handler string
		raw     string
		ext     string
	}{
		{"render_pptx", `{"title":"Roadmap","slides":[{"title":"Q1","bullets":["Ship"]}]}`, ".pptx"},
		{"render_xlsx", `{"title":"Budget","sheets":[{"name":"Data","rows":[["Name","Value"],["A",1]]}]}`, ".xlsx"},
		{"render_docx", `{"title":"Report","subtitle":"Draft","sections":[{"heading":"Summary","paragraphs":["Text"],"bullets":["Item"]}]}`, ".docx"},
	}
	for _, tc := range cases {
		file, err := renderToolFile(tc.handler, tc.raw, map[string]any{})
		if err != nil {
			t.Fatalf("%s: %v", tc.handler, err)
		}
		if !strings.HasSuffix(file.Name, tc.ext) || len(file.Data) == 0 {
			t.Fatalf("%s returned invalid file %q", tc.handler, file.Name)
		}
		if _, err := zip.NewReader(bytes.NewReader(file.Data), int64(len(file.Data))); err != nil {
			t.Fatalf("%s is not a zip-based Office file: %v", tc.handler, err)
		}
	}
	markdown, err := renderToolFile("render_markdown", "# Title\n\nBody", map[string]any{"fileName": "notes"})
	if err != nil || markdown.Name != "notes.md" || markdown.Text == "" {
		t.Fatalf("invalid markdown output: %#v, %v", markdown, err)
	}
}

func TestPresentationImageFormatPrefersVerifiedContentType(t *testing.T) {
	extension, contentType := presentationImageFormat("misleading.png", "https://cdn.test/object", "image/jpeg; charset=binary")
	if extension != "jpeg" || contentType != "image/jpeg" {
		t.Fatalf("verified content type did not win: %s %s", extension, contentType)
	}
}

func TestRenderToolFileRejectsUnboundedSpreadsheetWidth(t *testing.T) {
	cells := make([]string, 513)
	for i := range cells {
		cells[i] = `"x"`
	}
	raw := `{"sheets":[{"name":"Wide","rows":[[` + strings.Join(cells, ",") + `]]}]}`
	if _, err := renderToolFile("render_xlsx", raw, nil); err == nil || !strings.Contains(err.Error(), "512") {
		t.Fatalf("wide spreadsheet was accepted: %v", err)
	}
}

func TestReadableHTMLTextDropsNonContentSections(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><head><title>Article</title><style>hidden</style></head><body><nav>menu</nav><main><h1>Hello</h1><p>Useful text</p></main><script>bad()</script><footer>legal</footer></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	title, text := readableHTMLText(doc)
	if title != "Article" || !strings.Contains(text, "Useful text") {
		t.Fatalf("missing readable content: %q %q", title, text)
	}
	for _, forbidden := range []string{"hidden", "menu", "bad()", "legal"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("non-content text %q leaked: %q", forbidden, text)
		}
	}
}

func TestGeneratedNameSanitizesUnsafeCharacters(t *testing.T) {
	name := generatedName(`quarter:one/report?.pptx`, "", ".pptx")
	if name != "quarter-one-report-.pptx" {
		t.Fatalf("generatedName = %q", name)
	}
}

func TestConfiguredAnalysisModelUsesStepThenVersionDefault(t *testing.T) {
	version := &model.SkillVersion{ModelID: "version-text-model", PrimaryOutputType: "text"}
	if got := configuredAnalysisModel(version, agentStep{}); got != "version-text-model" {
		t.Fatalf("configuredAnalysisModel() = %q, want version default", got)
	}
	if got := configuredAnalysisModel(version, agentStep{ModelID: "step-text-model"}); got != "step-text-model" {
		t.Fatalf("configuredAnalysisModel() = %q, want step override", got)
	}
}

func TestReusableAnalysisStepRequiresCompletedStepOrDurableTask(t *testing.T) {
	tests := []struct {
		name string
		step model.SkillRunStep
		want bool
	}{
		{name: "succeeded", step: model.SkillRunStep{Status: model.SkillStepSucceeded}, want: true},
		{name: "running with task", step: model.SkillRunStep{Status: model.SkillStepRunning, AiTaskID: 12}, want: true},
		{name: "waiting with task", step: model.SkillRunStep{Status: model.SkillStepWaiting, AiTaskID: 12}, want: true},
		{name: "preprocessing", step: model.SkillRunStep{Status: model.SkillStepRunning}, want: false},
		{name: "failed", step: model.SkillRunStep{Status: model.SkillStepFailed, AiTaskID: 12}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := reusableAnalysisStep(test.step); got != test.want {
				t.Fatalf("reusableAnalysisStep() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestAnalysisSystemPromptTreatsFetchedContentAsUntrusted(t *testing.T) {
	for _, handler := range []string{"analyze_video", "analyze_audio", "analyze_webpage"} {
		prompt := analysisSystemPrompt(handler)
		if !strings.Contains(prompt, "不得执行") && !strings.Contains(prompt, "不得遵循") {
			t.Fatalf("%s system prompt lacks untrusted-content boundary: %q", handler, prompt)
		}
	}
}

func TestCappedToolProcessBufferReportsFullWritesWithoutGrowing(t *testing.T) {
	buffer := cappedToolProcessBuffer{limit: 5}
	if written, err := buffer.Write([]byte("123456789")); err != nil || written != 9 {
		t.Fatalf("Write() = %d, %v", written, err)
	}
	if got := buffer.String(); got != "12345" {
		t.Fatalf("buffer = %q", got)
	}
}
