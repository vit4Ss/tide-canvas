package skillrun

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tidecanvas/internal/app"
	"tidecanvas/internal/pkg/storage"
)

type attachmentTestStorage struct{ baseURL string }

func (s attachmentTestStorage) Save(context.Context, string, io.Reader, string) (string, error) {
	return "", nil
}
func (s attachmentTestStorage) Delete(context.Context, string) error { return nil }
func (s attachmentTestStorage) URL(key string) string {
	return strings.TrimRight(s.baseURL, "/") + "/bucket/" + strings.TrimLeft(key, "/")
}
func (s attachmentTestStorage) Presign(context.Context, string, string, int64) (storage.PresignResult, error) {
	return storage.PresignResult{}, storage.ErrUnsupported
}
func (s attachmentTestStorage) Stat(context.Context, string) (storage.ObjectMeta, error) {
	return storage.ObjectMeta{}, storage.ErrUnsupported
}
func (s attachmentTestStorage) Type() string                    { return "test" }
func (s attachmentTestStorage) UpstreamURL(value string) string { return value }
func (s attachmentTestStorage) FetchHosts() []string            { return nil }
func (s attachmentTestStorage) OwnsURL(value string) (string, bool) {
	return value, strings.HasPrefix(value, strings.TrimRight(s.baseURL, "/")+"/bucket/")
}
func (s attachmentTestStorage) PublicRewrites() [][2]string { return nil }

func TestRenderStepPromptSupportsInputAndContext(t *testing.T) {
	input := RunInput{Prompt: "main description", Parameters: map[string]any{"tone": "warm", "count": float64(3)}}
	contextJSON := `{"feedback":"less contrast","userInput":{"audience":"family"}}`
	got, err := renderStepPrompt("{{prompt}} | {{input.prompt}} | {{input.tone}} | {{input.parameters.count}} | {{context.feedback}} | {{context.userInput.audience}} | {{previous}}", input, "draft", contextJSON)
	if err != nil {
		t.Fatal(err)
	}
	want := "main description | main description | warm | 3 | less contrast | family | draft"
	if got != want {
		t.Fatalf("rendered prompt = %q, want %q", got, want)
	}
}

func TestSkillTextStepReceivesOwnedDocumentAttachment(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("reference document"))
	}))
	defer srv.Close()

	svc := &service{deps: &app.Deps{Storage: attachmentTestStorage{baseURL: srv.URL}}}
	command := map[string]any{"prompt": "make slides"}
	svc.addSkillTextAttachments(context.Background(), command, []AssetInput{{
		Type: "file", URL: srv.URL + "/bucket/opaque-object", Name: "reference.pdf",
	}})
	files, ok := command["files"].([]map[string]string)
	if !ok || len(files) != 1 || files[0]["filename"] != "reference.pdf" || !strings.HasPrefix(files[0]["dataUri"], "data:application/pdf;base64,") {
		t.Fatalf("document attachment was not encoded for the text model: %#v", command["files"])
	}
	if prompt, _ := command["prompt"].(string); !strings.Contains(prompt, "本条消息附带文件") {
		t.Fatalf("attachment note missing from prompt: %q", prompt)
	}
}

func TestGenerationInputKeepsMultipleReferenceImages(t *testing.T) {
	command := buildGenerationInput("{}", RunInput{Assets: []AssetInput{
		{Type: "image", URL: "https://cdn.test/one.png"},
		{Type: "image", URL: "https://cdn.test/two.png"},
	}}, "make slides")
	urls, ok := command["imageUrls"].([]string)
	if !ok || len(urls) != 2 || urls[0] != "https://cdn.test/one.png" || urls[1] != "https://cdn.test/two.png" {
		t.Fatalf("reference images were not preserved: %#v", command["imageUrls"])
	}
}

func TestAgentConversationContextIsExplicitAndDoesNotMutateCurrentPrompt(t *testing.T) {
	input := RunInput{
		Prompt: "把它改成夜景",
		Messages: []RunMessage{
			{Role: "user", Content: "生成一座未来城市"},
			{Role: "assistant", Content: "已经生成白天版本"},
		},
	}
	agentInput := withAgentConversationContext(input)
	if input.Prompt != "把它改成夜景" {
		t.Fatalf("source prompt was mutated: %q", input.Prompt)
	}
	for _, fragment := range []string{
		"<recent_conversation>",
		"用户：生成一座未来城市",
		"助手：已经生成白天版本",
		"<current_request>",
		"把它改成夜景",
	} {
		if !strings.Contains(agentInput.Prompt, fragment) {
			t.Fatalf("agent context missing %q: %s", fragment, agentInput.Prompt)
		}
	}
	if got := withAgentConversationContext(RunInput{Prompt: "single turn"}).Prompt; got != "single turn" {
		t.Fatalf("single-turn prompt changed: %q", got)
	}
}

func TestAgentStepPromptUsesConversationContextWhilePresetCanStaySingleTurn(t *testing.T) {
	input := RunInput{
		Prompt:   "继续细化",
		Messages: []RunMessage{{Role: "assistant", Content: "上一版是暖色调"}},
	}
	agentInput := withAgentConversationContext(input)
	agentPrompt, err := renderStepPrompt("{{prompt}}", agentInput, "", "{}")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(agentPrompt, "上一版是暖色调") || !strings.Contains(agentPrompt, "继续细化") {
		t.Fatalf("agent prompt lost conversation context: %q", agentPrompt)
	}
	presetPrompt, err := renderStepPrompt("{{prompt}}", input, "", "{}")
	if err != nil {
		t.Fatal(err)
	}
	if presetPrompt != "继续细化" {
		t.Fatalf("preset-style prompt unexpectedly included history: %q", presetPrompt)
	}
}

func TestRenderStepPromptRejectsExpansionBomb(t *testing.T) {
	input := RunInput{Prompt: strings.Repeat("x", 32<<10)}
	if _, err := renderStepPrompt(strings.Repeat("{{prompt}}", 1000), input, "", "{}"); err == nil {
		t.Fatal("oversized rendered prompt was accepted")
	}
}

func TestHandlerForUsesOwnedImageReferenceMode(t *testing.T) {
	assets := []AssetInput{{Type: "image", URL: "https://cdn.test/source.png"}}
	if got := handlerFor("image", assets); got != "image_to_image" {
		t.Fatalf("image handler = %q", got)
	}
	if got := handlerFor("video", assets); got != "image_to_video" {
		t.Fatalf("video handler = %q", got)
	}
}

func TestAgentTextStepFallsBackToPrimarySkillFile(t *testing.T) {
	if got := agentStepSystemPrompt("", "# Skill instructions"); got != "# Skill instructions" {
		t.Fatalf("fallback system prompt = %q", got)
	}
	if got := agentStepSystemPrompt("step override", "# Skill instructions"); got != "step override" {
		t.Fatalf("explicit system prompt did not win: %q", got)
	}
}

func TestRequestedAgentStepModelSeparatesTextAndMediaOverrides(t *testing.T) {
	parameters := map[string]any{"modelId": "image-model", "textModelId": "text-model"}
	if got := requestedAgentStepModel(parameters, "text", "image"); got != "text-model" {
		t.Fatalf("text step model = %q, want text-model", got)
	}
	if got := requestedAgentStepModel(parameters, "generate", "image"); got != "image-model" {
		t.Fatalf("media step model = %q, want image-model", got)
	}
	delete(parameters, "textModelId")
	if got := requestedAgentStepModel(parameters, "text", "image"); got != "" {
		t.Fatalf("media agent text step inherited media model %q", got)
	}
	if got := requestedAgentStepModel(parameters, "text", "text"); got != "image-model" {
		t.Fatalf("text-primary agent compatibility model = %q, want image-model", got)
	}
}

func TestExpandSkillTemplateFilesResolvesNestedPackageReferences(t *testing.T) {
	files := map[string]string{
		"MySkill/SKILL.md":            "Rules: {{skill.file:references/style.md}}",
		"MySkill/references/style.md": "cinematic light",
	}
	got, err := expandSkillTemplateFiles("MySkill/SKILL.md", "{{skill.primary}}", files)
	if err != nil {
		t.Fatal(err)
	}
	if got != "Rules: cinematic light" {
		t.Fatalf("unexpected expansion: %q", got)
	}
}
