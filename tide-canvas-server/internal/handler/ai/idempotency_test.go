package ai

import (
	"encoding/json"
	"testing"
)

func TestDirectGenerationFingerprintCanonicalizesJSON(t *testing.T) {
	a := generateDTO{Handler: "text_to_image", ModelID: "m1", EntryPoint: "canvas", TargetType: "character", Input: json.RawMessage(`{"prompt":"hero","n":1}`)}
	b := a
	b.Input = json.RawMessage("{\n  \"n\": 1, \"prompt\": \"hero\"\n}")
	ha, err := directGenerationFingerprint(a)
	if err != nil {
		t.Fatal(err)
	}
	hb, err := directGenerationFingerprint(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha != hb {
		t.Fatalf("equivalent JSON produced different hashes: %s != %s", ha, hb)
	}
	b.Input = json.RawMessage(`{"prompt":"villain","n":1}`)
	hb, _ = directGenerationFingerprint(b)
	if ha == hb {
		t.Fatal("different generation requests produced the same hash")
	}
}
