package ai

import (
	"encoding/json"
	"testing"

	"tidecanvas/internal/model"
)

func TestCanonicalToolRequestRequiresExactPair(t *testing.T) {
	for i := range model.CanonicalAiTools {
		want := &model.CanonicalAiTools[i]
		raw, err := json.Marshal(map[string]any{"toolKey": want.Key})
		if err != nil {
			t.Fatal(err)
		}
		got, marker := canonicalToolRequest(want.Handler, raw)
		if !marker || got == nil || got.Key != want.Key {
			t.Fatalf("canonical pair %s/%s was not recognized: marker=%v tool=%#v", want.Handler, want.Key, marker, got)
		}
		if mismatched, marker := canonicalToolRequest("text_to_image", raw); !marker || mismatched != nil {
			t.Fatalf("mismatched pair for %s must be rejected: marker=%v tool=%#v", want.Key, marker, mismatched)
		}
	}
}

func TestCanonicalToolRequestDoesNotGuessLegacyRows(t *testing.T) {
	if tool, marker := canonicalToolRequest("outpaint", json.RawMessage(`{"prompt":"legacy studio edit"}`)); marker || tool != nil {
		t.Fatalf("untagged Studio request must stay unclassified: marker=%v tool=%#v", marker, tool)
	}
	if tool, marker := canonicalToolRequest("outpaint", json.RawMessage(`{"toolKey":42}`)); !marker || tool != nil {
		t.Fatalf("invalid marker must be visible and rejected: marker=%v tool=%#v", marker, tool)
	}
}
