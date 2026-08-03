package skillrun

import (
	"strings"
	"testing"
)

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
