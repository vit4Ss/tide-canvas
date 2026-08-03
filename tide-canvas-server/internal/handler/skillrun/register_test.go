package skillrun

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/go-playground/validator/v10"

	"tidecanvas/internal/model"
)

func TestVersionPlacementExactDisabledOverridesWildcard(t *testing.T) {
	version := &model.SkillVersion{BindingsJSON: `[{"surface":"canvas","targetType":"*","enabled":true},{"surface":"canvas","targetType":"character","enabled":false}]`}
	placement, err := (&service{}).versionPlacement(version, "canvas", "character")
	if err != nil {
		t.Fatal(err)
	}
	if placement != nil {
		t.Fatalf("exact disabled binding did not deny wildcard: %#v", placement)
	}
	version.BindingsJSON = `[{"surface":"canvas","targetType":"*","enabled":true,"defaults":{"quality":"draft"}},{"surface":"canvas","targetType":"character","enabled":true,"defaults":{"quality":"high"}}]`
	placement, err = (&service{}).versionPlacement(version, "canvas", "character")
	if err != nil || placement == nil {
		t.Fatalf("exact enabled binding was not selected: %#v, %v", placement, err)
	}
	var defaults map[string]any
	if json.Unmarshal(placement.Defaults, &defaults) != nil || defaults["quality"] != "high" {
		t.Fatalf("wrong exact defaults: %s", placement.Defaults)
	}
}

func TestCreateDTORequiresClientRequestID(t *testing.T) {
	dto := CreateDTO{SkillID: "1", EntryPoint: "canvas"}
	validate := validator.New()
	validate.SetTagName("binding")
	if err := validate.Struct(dto); err == nil {
		t.Fatal("missing clientRequestId passed request validation")
	}
	if _, _, err := (&service{}).createRun(context.Background(), 1, CreateDTO{ClientRequestID: "   "}); err == nil || !strings.Contains(err.Error(), "clientRequestId") {
		t.Fatalf("whitespace clientRequestId was not rejected before DB access: %v", err)
	}
}

func TestParseClientRequestIDs(t *testing.T) {
	values, err := parseClientRequestIDs(`[" canvas,a ","line\nbreak"," canvas,a "]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 || values[0] != "canvas,a" || values[1] != "line\nbreak" {
		t.Fatalf("unexpected ids: %#v", values)
	}
	for _, raw := range []string{
		`[]`,
		`not-json`,
		`["` + strings.Repeat("x", 97) + `"]`,
		`[` + strings.TrimSuffix(strings.Repeat(`"id",`, 41), ",") + `]`,
	} {
		if _, err := parseClientRequestIDs(raw); err == nil {
			t.Fatalf("invalid clientRequestIds accepted: %q", raw)
		}
	}
}

func TestValidateRunInputLimits(t *testing.T) {
	valid := RunInput{
		Prompt:     "hello",
		Messages:   []RunMessage{{Role: "user", Content: "earlier request"}, {Role: "assistant", Content: "earlier answer"}},
		Parameters: map[string]any{"tone": "calm"},
		Assets:     []AssetInput{{Type: "text", Content: "context"}},
	}
	if err := validateRunInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	tests := []RunInput{
		{Prompt: strings.Repeat("x", (32<<10)+1)},
		{Messages: make([]RunMessage, 41)},
		{Messages: []RunMessage{{Role: "system", Content: "not allowed"}}},
		{Messages: []RunMessage{{Role: "user", Content: "   "}}},
		{Messages: []RunMessage{{Role: "user", Content: strings.Repeat("x", (256<<10)+1)}}},
		{Assets: make([]AssetInput, 33)},
		{SourceNodeIDs: make([]string, 65)},
		{Assets: []AssetInput{{Content: strings.Repeat("x", (256<<10)+1)}}},
	}
	for index, input := range tests {
		if err := validateRunInput(input); err == nil {
			t.Errorf("case %d accepted oversized input", index)
		} else {
			var validation validationError
			if !errors.As(err, &validation) {
				t.Errorf("case %d returned non-validation error %T", index, err)
			}
		}
	}
}

func TestValidateSchemaValues(t *testing.T) {
	schema := `{"type":"object","required":["tone","count"],"properties":{"tone":{"type":"string","enum":["calm","bold"]},"count":{"type":"integer","minimum":1,"maximum":3}}}`
	if err := validateSchemaValues(schema, map[string]any{"tone": "calm", "count": float64(2)}); err != nil {
		t.Fatalf("valid values rejected: %v", err)
	}
	for _, values := range []map[string]any{
		{"count": float64(2)},
		{"tone": "loud", "count": float64(2)},
		{"tone": "calm", "count": float64(4)},
		{"tone": "calm", "count": 1.5},
	} {
		if err := validateSchemaValues(schema, values); err == nil {
			t.Errorf("invalid values accepted: %#v", values)
		}
	}
}

func TestSchemaValidationIncludesReservedRunInput(t *testing.T) {
	schema := `{"type":"object","required":["prompt","assets","sourceNodeIds"]}`
	valid := RunInput{Prompt: "hello", Assets: []AssetInput{{Type: "image", URL: "https://cdn.test/a.png"}}, SourceNodeIDs: []string{"node-1"}}
	if err := validateSchemaValues(schema, runInputValues(valid)); err != nil {
		t.Fatal(err)
	}
	if err := validateSchemaValues(schema, runInputValues(RunInput{})); err == nil {
		t.Fatal("missing reserved input fields were accepted")
	}
}

func TestMergeRunParametersUsesPlacementPrecedence(t *testing.T) {
	merged, err := mergeRunParameters(`{"quality":"draft","steps":1}`, []byte(`{"quality":"high","style":"cinematic"}`), map[string]any{"quality": "ultra"})
	if err != nil {
		t.Fatal(err)
	}
	if merged["quality"] != "ultra" || merged["style"] != "cinematic" || merged["steps"] != float64(1) {
		t.Fatalf("unexpected merged defaults: %#v", merged)
	}
}

func TestValidateCompactSchemaFields(t *testing.T) {
	schema := `{"fields":[{"key":"tone","type":"select","options":[{"label":"Calm","value":"calm"},{"label":"Bold","value":"bold"}]},{"key":"strength","type":"number","min":1,"max":3}]}`
	if err := validateSchemaValues(schema, map[string]any{"tone": "calm", "strength": float64(2)}); err != nil {
		t.Fatal(err)
	}
	for _, values := range []map[string]any{{"tone": "other", "strength": float64(2)}, {"tone": "calm", "strength": float64(4)}} {
		if err := validateSchemaValues(schema, values); err == nil {
			t.Fatalf("compact schema accepted invalid values: %#v", values)
		}
	}
}

func TestValidateSchemaValuesEnforcesStringAndArrayConstraints(t *testing.T) {
	schema := `{"type":"object","properties":{"name":{"type":"string","minLength":2,"maxLength":4,"pattern":"^[a-z]+$"},"assets":{"type":"array","minItems":1,"maxItems":2,"items":{"type":"object","required":["url"],"properties":{"url":{"type":"string","minLength":8}},"additionalProperties":false}}},"additionalProperties":false}`
	valid := map[string]any{"name": "hero", "assets": []any{map[string]any{"url": "https://a"}}}
	if err := validateSchemaValues(schema, valid); err != nil {
		t.Fatal(err)
	}
	for _, values := range []map[string]any{
		{"name": "A", "assets": []any{map[string]any{"url": "https://a"}}},
		{"name": "hero", "assets": []any{}},
		{"name": "hero", "assets": []any{map[string]any{}}},
		{"name": "hero", "assets": []any{map[string]any{"url": "https://a", "extra": true}}},
		{"name": "hero", "assets": []any{map[string]any{"url": "https://a"}}, "unknown": true},
	} {
		if err := validateSchemaValues(schema, values); err == nil {
			t.Fatalf("schema accepted invalid values: %#v", values)
		}
	}
}

func TestMetadataContainsExactOwnedURL(t *testing.T) {
	raw := `{"urls":["https://cdn.test/a.png","https://cdn.test/b.png"],"images":[{"url":"https://cdn.test/c.png"}]}`
	for _, url := range []string{"https://cdn.test/a.png", "https://cdn.test/c.png"} {
		if !metadataContainsURL(raw, url) {
			t.Errorf("metadata did not contain %s", url)
		}
	}
	if metadataContainsURL(raw, "https://cdn.test/a") {
		t.Error("metadata substring was trusted without exact structural match")
	}
}

func TestOwnedAssetIDCannotAuthorizeAnotherURL(t *testing.T) {
	stored := "https://cdn.test/owned.png"
	if !matchesOwnedAssetURL("", stored) || !matchesOwnedAssetURL(stored, stored) {
		t.Fatal("empty or exact client URL should match the server-owned URL")
	}
	if matchesOwnedAssetURL("https://attacker.test/other.png", stored) {
		t.Fatal("an owned ID must not authorize an unrelated client URL")
	}
}
