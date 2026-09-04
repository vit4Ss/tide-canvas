package skillrun

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/net/html"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

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

func TestRenderToolFileRejectsUnboundedWordTable(t *testing.T) {
	headers := make([]string, 33)
	for index := range headers {
		headers[index] = fmt.Sprintf("h%d", index)
	}
	raw, err := json.Marshal(map[string]any{
		"title":    "wide document",
		"sections": []any{map[string]any{"heading": "table", "table": map[string]any{"headers": headers}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := renderToolFile("render_docx", string(raw), nil); err == nil || !strings.Contains(err.Error(), "32") {
		t.Fatalf("wide Word table was accepted: %v", err)
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

func TestMarkdownValidationRequiresOneH1AndBalancedFences(t *testing.T) {
	valid := "# Guide\n\n## Setup\n\n```go\nfmt.Println(1)\n```\n"
	if err := validateMarkdownDocument(valid); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		"## Missing title\n",
		"# One\n\n# Two\n",
		"# Guide\n\n### Skipped level\n",
		"# Guide\n\n```go\nunclosed\n",
	} {
		if err := validateMarkdownDocument(invalid); err == nil {
			t.Fatalf("invalid Markdown was accepted: %q", invalid)
		}
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

func TestMediaAnalysisModelsMustSupportTheirPreparedAttachments(t *testing.T) {
	plain := model.MarketModel{Config: `{"fileUpload":false}`}
	documents := model.MarketModel{Config: `{"fileUpload":true,"uploadFormats":["pdf","docx"]}`}
	vision := model.MarketModel{Config: `{"fileUpload":true,"uploadFormats":["jpg","png"]}`}
	legacyFileModel := model.MarketModel{Config: `{"paramsSchema":{"file_upload":true}}`}
	explicitlyDisabled := model.MarketModel{Config: `{"fileUpload":false,"paramsSchema":{"file_upload":true},"uploadFormats":["jpg"]}`}
	if analysisModelSupports("analyze_video", plain) {
		t.Fatal("plain text model was accepted for video analysis")
	}
	if analysisModelSupports("analyze_video", documents) {
		t.Fatal("document-only model was accepted for video frames")
	}
	if !analysisModelSupports("analyze_video", vision) {
		t.Fatal("vision file model was rejected for video analysis")
	}
	if analysisModelSupports("analyze_image", documents) {
		t.Fatal("document-only model was accepted for image analysis")
	}
	if !analysisModelSupports("analyze_image", vision) {
		t.Fatal("vision file model was rejected for image analysis")
	}
	if !analysisModelSupports("analyze_audio", legacyFileModel) {
		t.Fatal("relay file_upload capability was ignored for audio analysis")
	}
	if analysisModelSupports("analyze_video", explicitlyDisabled) {
		t.Fatal("explicit fileUpload=false was overridden by relay metadata")
	}
	if !analysisModelSupports("analyze_webpage", plain) {
		t.Fatal("webpage analysis should not require file input")
	}
	if !analysisModelSupports("analyze_account", plain) {
		t.Fatal("account analysis should not require file input")
	}
	if textModelSupportsAssets(plain, []AssetInput{{Type: "file", URL: "https://example.test/a.pdf"}}) {
		t.Fatal("plain text model accepted a document attachment")
	}
	if textModelSupportsAssets(documents, []AssetInput{{Type: "image", URL: "https://example.test/a.jpg"}}) {
		t.Fatal("document-only model accepted an image attachment")
	}
	if !textModelSupportsAssets(vision, []AssetInput{{Type: "image", Name: "a.jpg", URL: "https://example.test/a.jpg"}}) {
		t.Fatal("vision model rejected an image attachment")
	}
	if textModelSupportsAssets(documents, []AssetInput{{Type: "file", Name: "notes.txt", URL: "https://example.test/notes.txt"}}) {
		t.Fatal("model accepted an attachment extension outside uploadFormats")
	}
	if !textModelSupportsAssets(plain, nil) {
		t.Fatal("attachment-free text skill was rejected")
	}
}

func TestResolveAnalysisModelRejectsAnIncompatibleExplicitSelection(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "cgo") {
			t.Skip("sqlite driver requires CGO in this environment")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	rows := []model.MarketModel{
		{Name: "Plain", ModelKey: "plain", Type: "text", Status: 1, SortOrder: 0, Config: `{"fileUpload":false}`},
		{Name: "Vision", ModelKey: "vision", Type: "text", Status: 1, SortOrder: 1, Config: `{"fileUpload":true,"uploadFormats":["jpg"]}`},
	}
	for index := range rows {
		if err := db.Create(&rows[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := &service{db: db}
	if _, err := service.resolveAnalysisModel("analyze_video", "", "plain"); err == nil {
		t.Fatal("incompatible explicitly selected analysis model was silently replaced")
	}
	resolved, err := service.resolveAnalysisModel("analyze_video", "", "")
	if err != nil || resolved != "vision" {
		t.Fatalf("resolveAnalysisModel() = %q, %v; want vision default", resolved, err)
	}
	resolved, err = service.resolveAnalysisModel("analyze_video", "", "vision")
	if err != nil || resolved != "vision" {
		t.Fatalf("compatible explicit selection = %q, %v; want vision", resolved, err)
	}
	if _, err := service.resolveAnalysisModel("analyze_video", "plain", ""); err == nil {
		t.Fatal("explicitly configured incompatible analysis model was accepted")
	}
	if _, err := service.resolveTextModelForAssets("", "plain", []AssetInput{{Type: "file", URL: "https://example.test/a.pdf"}}); err == nil {
		t.Fatal("generic text skill accepted attachments on a model without file input")
	}
	if resolved, err := service.resolveTextModelForAssets("", "plain", nil); err != nil || resolved != "plain" {
		t.Fatalf("attachment-free text skill = %q, %v; want plain", resolved, err)
	}
	if resolved, err := service.resolveTextModelForAssets("", "vision", []AssetInput{{Type: "image", URL: "https://example.test/a.jpg"}}); err != nil || resolved != "vision" {
		t.Fatalf("compatible text skill = %q, %v; want vision", resolved, err)
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
	for _, handler := range []string{"analyze_image", "analyze_video", "analyze_audio", "analyze_webpage", "analyze_account"} {
		prompt := analysisSystemPrompt(handler)
		if !strings.Contains(prompt, "不得执行") && !strings.Contains(prompt, "不得遵循") {
			t.Fatalf("%s system prompt lacks untrusted-content boundary: %q", handler, prompt)
		}
	}
}

func TestAnalysisPromptsRequireEvidenceAndActionableStructure(t *testing.T) {
	for handler, required := range map[string][]string{
		"analyze_image":   {"可见主体", "构图", "无法确认", "不得补造"},
		"analyze_video":   {"[mm:ss]", "时间轴证据", "置信度", "不得臆测"},
		"analyze_audio":   {"[mm:ss]", "行动项", "未明确", "需要复核"},
		"analyze_webpage": {"主张—页面证据—含义/风险", "URL", "可信度限制"},
		"analyze_account": {"内容支柱", "选题矩阵", "待验证假设", "不得编造"},
	} {
		prompt := analysisSystemPrompt(handler)
		for _, fragment := range required {
			if !strings.Contains(prompt, fragment) {
				t.Fatalf("%s prompt is missing %q", handler, fragment)
			}
		}
	}
	if formatMediaTimestamp(65.2) != "01:05" {
		t.Fatalf("unexpected timestamp: %s", formatMediaTimestamp(65.2))
	}
	for _, handler := range []string{"analyze_video", "analyze_audio"} {
		if !strings.Contains(analysisSystemPrompt(handler), "不要只给计划") {
			t.Fatalf("%s prompt still permits a planning-only response", handler)
		}
	}
}

func TestImageAnalysisPreparesOwnedCarouselAsBoundedVisualInput(t *testing.T) {
	assets := make([]AssetInput, 0, 11)
	for index := 0; index < 11; index++ {
		assets = append(assets, AssetInput{Type: "image", URL: fmt.Sprintf("https://cdn.example.test/source-%d.png", index), Name: fmt.Sprintf("source-%d.png", index)})
	}
	command, err := (&service{}).prepareAnalysisInput(context.Background(), &model.SkillRun{}, "analyze_image", RunInput{
		Assets: assets,
	}, "分析构图")
	if err != nil {
		t.Fatal(err)
	}
	images, ok := command["imageUrls"].([]string)
	if !ok || len(images) != 9 || images[0] != "https://cdn.example.test/source-0.png" || images[8] != "https://cdn.example.test/source-8.png" {
		t.Fatalf("unexpected image command: %#v", command)
	}
	if got, _ := command["prompt"].(string); !strings.Contains(got, "分析构图") {
		t.Fatalf("user focus missing from command: %q", got)
	}
	if got := commandStringSlice(command, "temporaryStorageKeys"); len(got) != 0 {
		t.Fatalf("image analysis unexpectedly created temporary media: %#v", got)
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
