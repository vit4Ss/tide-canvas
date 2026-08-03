package ai

import (
	"testing"

	"tidecanvas/internal/model"
)

func TestResolveSkillPlacementExactDisabledOverridesWildcard(t *testing.T) {
	bindings := []skillPlacementBinding{
		{Surface: "canvas", TargetType: "*", Enabled: true},
		{Surface: "canvas", TargetType: "character", Enabled: false},
	}
	if got := resolveSkillPlacement(bindings, "canvas", "character"); got != nil {
		t.Fatalf("exact disabled binding did not deny wildcard: %#v", got)
	}
	if got := resolveSkillPlacement(bindings, "canvas", "scene"); got == nil || got.TargetType != "*" {
		t.Fatalf("wildcard was not selected when exact is absent: %#v", got)
	}
}

func TestPresetSupportsEveryDeclaredOutput(t *testing.T) {
	version := &model.SkillVersion{Kind: model.SkillKindPreset, PrimaryOutputType: "image", OutputTypes: `["image","text"]`}
	if !presetSupportsOutput(version, "image") || !presetSupportsOutput(version, "TEXT") {
		t.Fatal("declared primary or secondary preset output was rejected")
	}
	if presetSupportsOutput(version, "video") {
		t.Fatal("undeclared preset output was accepted")
	}
	version.Kind = model.SkillKindAgent
	if presetSupportsOutput(version, "image") {
		t.Fatal("non-preset version was accepted by preset resolver")
	}
}

func TestModelSupportsSkillOutput(t *testing.T) {
	for _, tc := range []struct {
		name       string
		modelType  string
		outputType string
		want       bool
	}{
		{name: "same modality", modelType: "image", outputType: "IMAGE", want: true},
		{name: "cross modality", modelType: "image", outputType: "video", want: false},
		{name: "file uses text model", modelType: "text", outputType: "file", want: true},
		{name: "empty type", modelType: "", outputType: "text", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelSupportsSkillOutput(tc.modelType, tc.outputType); got != tc.want {
				t.Fatalf("modelSupportsSkillOutput(%q, %q) = %v, want %v", tc.modelType, tc.outputType, got, tc.want)
			}
		})
	}
}
