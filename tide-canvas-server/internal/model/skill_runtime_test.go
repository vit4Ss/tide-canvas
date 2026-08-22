package model

import (
	"encoding/json"
	"testing"
)

func TestValidSkillKindHasThreePublicKinds(t *testing.T) {
	if !ValidSkillKind(SkillKindPreset) || !ValidSkillKind(SkillKindAgent) || !ValidSkillKind(SkillKindTool) {
		t.Fatal("preset, agent and tool must remain valid")
	}
	if ValidSkillKind("workflow") || ValidSkillKind("") {
		t.Fatal("legacy or empty kind was accepted")
	}
}

func TestLegacyWorkflowManifestAndBindingsNormalizeToAgent(t *testing.T) {
	raw := `{"kind":"workflow","steps":[{"key":"image","type":"generate","outputType":"image"},{"key":"video","type":"generate","outputType":"video"}]}`
	normalized := normalizePersistedSkillManifest(raw, SkillKindAgent, "video", []string{"image", "video"})
	var manifest map[string]any
	if json.Unmarshal([]byte(normalized), &manifest) != nil || manifest["kind"] != SkillKindAgent {
		t.Fatalf("manifest kind was not normalized: %s", normalized)
	}
	if steps, ok := manifest["steps"].([]any); !ok || len(steps) != 2 {
		t.Fatalf("agent steps were not preserved: %s", normalized)
	}
	bindings := canvasOnlySkillBindings(`[{"surface":"canvas","targetType":"*","enabled":true},{"surface":"asset","targetType":"general","enabled":true}]`)
	if len(bindings) != 1 || bindings[0].Surface != "canvas" {
		t.Fatalf("agent bindings were not converged to canvas: %#v", bindings)
	}
	if !liveSkillBindingsMatch([]SkillSurfaceBinding{{Surface: "canvas", TargetType: "*", Enabled: true, Defaults: `{ "x": 1 }`}},
		[]normalizedSkillBinding{{Surface: "canvas", TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{"x":1}`)}}) {
		t.Fatal("equivalent live canvas binding was not treated as idempotent")
	}
	presetBindings := presetSkillBindings(`[{"surface":"studio","targetType":"*","enabled":true},{"surface":"api","targetType":"*","enabled":true}]`)
	if len(presetBindings) != 1 || presetBindings[0].Surface != "studio" {
		t.Fatalf("preset bindings retained a retired surface: %#v", presetBindings)
	}
}

func TestLegacySkillBindingTargetRestrictsNonImageAssets(t *testing.T) {
	for _, output := range []string{"audio", "video", "text", "file"} {
		if got := legacySkillBindingTarget("asset", output); got != "general" {
			t.Errorf("asset/%s target = %q, want general", output, got)
		}
	}
	if got := legacySkillBindingTarget("asset", "image"); got != "*" {
		t.Errorf("asset/image target = %q, want wildcard", got)
	}
	if got := legacySkillBindingTarget("canvas", "video"); got != "*" {
		t.Errorf("canvas/video target = %q, want wildcard", got)
	}
}

func TestGeneratedLegacyAssetWildcardRewriteShape(t *testing.T) {
	snapshots := []map[string]any{
		{"surface": "canvas", "targetType": "*", "enabled": true},
		{"surface": "asset", "targetType": "*", "enabled": true},
	}
	if !rewriteLegacyAssetWildcard(snapshots) || snapshots[0]["targetType"] != "*" || snapshots[1]["targetType"] != "general" {
		t.Fatalf("unexpected corrected snapshots: %#v", snapshots)
	}
}
