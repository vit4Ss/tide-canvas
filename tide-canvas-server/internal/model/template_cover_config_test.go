package model

import (
	"encoding/json"
	"testing"
)

func TestTemplateCoverBatchConfigIsExplicitlyOptIn(t *testing.T) {
	for _, raw := range []string{"", "{}", `{"imagePrimary":true}`, `{"templateCoverBatch":false}`, `{"templateCoverBatch":"true"}`} {
		if ModelConfigTemplateCoverBatch(raw) {
			t.Fatal("implicit opt-in", raw)
		}
	}
	for _, tc := range []struct {
		typ, raw string
		valid    bool
	}{
		{"image", `{"templateCoverBatch":true,"modes":["t2i"]}`, true},
		{"image", `{"templateCoverBatch":true}`, true},
		{"image", `{"templateCoverBatch":true,"modes":["i2i"]}`, false},
		{"video", `{"templateCoverBatch":true}`, false},
		{"image", `{"templateCoverBatch":null}`, false},
		{"image", `{"templateCoverBatch":"true"}`, false},
		{"video", `{"templateCoverBatch":false}`, true},
	} {
		if (ValidateTemplateCoverConfig(tc.typ, json.RawMessage(tc.raw)) == nil) != tc.valid {
			t.Fatal(tc)
		}
	}
}
