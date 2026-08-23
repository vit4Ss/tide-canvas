package skill

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBaselineToolSkillsAreCompleteAndValidJSON(t *testing.T) {
	if len(baselineToolSkills) != 7 {
		t.Fatalf("tool seed count = %d, want 7", len(baselineToolSkills))
	}
	seen := map[string]bool{}
	for _, definition := range baselineToolSkills {
		if definition.key == "" || definition.title == "" || seen[definition.key] {
			t.Fatalf("invalid or duplicate tool seed: %#v", definition)
		}
		seen[definition.key] = true
		for label, raw := range map[string]string{"inputSchema": definition.inputSchema, "manifest": definition.manifest} {
			var value map[string]any
			if json.Unmarshal([]byte(raw), &value) != nil || value == nil {
				t.Fatalf("%s %s is not a JSON object", definition.key, label)
			}
		}
		if definition.defaultParams != "" {
			var defaults map[string]any
			if json.Unmarshal([]byte(definition.defaultParams), &defaults) != nil || defaults == nil {
				t.Fatalf("%s defaultParams is not a JSON object", definition.key)
			}
		}
		var manifest struct {
			Kind  string `json:"kind"`
			Steps []struct {
				Type    string `json:"type"`
				Handler string `json:"handler"`
			} `json:"steps"`
		}
		if err := json.Unmarshal([]byte(definition.manifest), &manifest); err != nil {
			t.Fatal(err)
		}
		if manifest.Kind != "tool" || len(manifest.Steps) == 0 {
			t.Fatalf("%s has no tool manifest steps", definition.key)
		}
		toolSteps := 0
		for _, step := range manifest.Steps {
			if step.Type == "tool" && step.Handler != "" {
				toolSteps++
			}
		}
		if toolSteps == 0 {
			t.Fatalf("%s has no registered tool step", definition.key)
		}
	}
}

func TestPublicInputSchemaKeepsReservedRequirements(t *testing.T) {
	raw := `{"type":"object","x-asset-types":["video"],"required":["prompt","assets","focus"],"properties":{"prompt":{"type":"string"},"assets":{"type":"array"},"focus":{"type":"string"}}}`
	var schema map[string]any
	if err := json.Unmarshal(publicInputSchema(raw), &schema); err != nil {
		t.Fatal(err)
	}
	properties, _ := schema["properties"].(map[string]any)
	if _, exists := properties["prompt"]; exists {
		t.Fatal("reserved prompt definition leaked")
	}
	if _, exists := properties["assets"]; exists {
		t.Fatal("reserved assets definition leaked")
	}
	required, _ := schema["required"].([]any)
	if len(required) != 3 {
		t.Fatalf("reserved requirements were removed: %#v", required)
	}
}

func TestPPTSeedUsesCommercialNarrativeSchemaV3(t *testing.T) {
	if baselineToolVersion("tool-pptx") != 3 {
		t.Fatal("PPT seed must upgrade untouched official v1/v2 snapshots")
	}
	var ppt seedToolSkill
	for _, definition := range baselineToolSkills {
		if definition.key == "tool-pptx" {
			ppt = definition
			break
		}
	}
	for _, required := range []string{"imageIndexes", "metrics", "comparison", "timeline", "closing", "参考图", "polish", "AUTO", "智能匹配"} {
		if !strings.Contains(ppt.manifest, required) {
			t.Fatalf("PPT commercial prompt is missing %q", required)
		}
	}
}

func TestOtherToolSeedsUseReviewedV2Workflows(t *testing.T) {
	for _, definition := range baselineToolSkills {
		if definition.key == "tool-pptx" {
			continue
		}
		if baselineToolVersion(definition.key) != 2 {
			t.Fatalf("%s must publish the reviewed v2 workflow", definition.key)
		}
	}
	checks := map[string][]string{
		"tool-xlsx":           {"audit", "formula", "freezeRows", "autoFilter"},
		"tool-docx":           {"edit", "numbered", "callout", "table"},
		"tool-markdown":       {"edit", "标题层级", "代码围栏"},
		"tool-video-analysis": {"analyze_video"},
		"tool-audio-analysis": {"analyze_audio"},
		"tool-web-analysis":   {"analyze_webpage"},
	}
	for _, definition := range baselineToolSkills {
		for _, required := range checks[definition.key] {
			if !strings.Contains(definition.manifest+definition.instructions, required) {
				t.Fatalf("%s v2 workflow is missing %q", definition.key, required)
			}
		}
	}
}
