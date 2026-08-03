package model

import "testing"

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
