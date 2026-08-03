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

func TestWorkflowTextStepFallsBackToPrimarySkillFile(t *testing.T) {
	if got := workflowSystemPrompt("", "# Skill instructions"); got != "# Skill instructions" {
		t.Fatalf("fallback system prompt = %q", got)
	}
	if got := workflowSystemPrompt("step override", "# Skill instructions"); got != "step override" {
		t.Fatalf("explicit system prompt did not win: %q", got)
	}
}

func TestRequestedWorkflowModelSeparatesTextAndMediaOverrides(t *testing.T) {
	parameters := map[string]any{"modelId": "image-model", "textModelId": "text-model"}
	if got := requestedWorkflowModel(parameters, "text", "image"); got != "text-model" {
		t.Fatalf("text step model = %q, want text-model", got)
	}
	if got := requestedWorkflowModel(parameters, "generate", "image"); got != "image-model" {
		t.Fatalf("media step model = %q, want image-model", got)
	}
	delete(parameters, "textModelId")
	if got := requestedWorkflowModel(parameters, "text", "image"); got != "" {
		t.Fatalf("media workflow text step inherited media model %q", got)
	}
	if got := requestedWorkflowModel(parameters, "text", "text"); got != "image-model" {
		t.Fatalf("text-primary workflow compatibility model = %q, want image-model", got)
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
