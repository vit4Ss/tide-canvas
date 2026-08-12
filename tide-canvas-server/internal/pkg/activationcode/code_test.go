package activationcode

import (
	"strings"
	"testing"
)

func TestGenerateNormalizeHashAndHint(t *testing.T) {
	code, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 19 || !strings.HasPrefix(code, "FLOW-") {
		t.Fatalf("generated code %q has unexpected format", code)
	}
	normalized, err := Normalize(strings.ToLower(strings.ReplaceAll(code, "-", " ")))
	if err != nil {
		t.Fatal(err)
	}
	if normalized != strings.ReplaceAll(code, "-", "") {
		t.Fatalf("normalized = %q", normalized)
	}
	hash, err := Hash(code)
	if err != nil || len(hash) != 64 || strings.Contains(hash, "FLOW") {
		t.Fatalf("hash = %q, err = %v", hash, err)
	}
	hint, err := Hint(code)
	if err != nil || !strings.HasPrefix(hint, "FLOW-****-****-") || strings.Contains(hint, code[5:13]) {
		t.Fatalf("hint = %q, err = %v", hint, err)
	}
}

func TestNormalizeRejectsInvalidInput(t *testing.T) {
	for _, code := range []string{"", "short", "FLOW-ABC$-1234", strings.Repeat("A", 65)} {
		if _, err := Normalize(code); err == nil {
			t.Fatalf("Normalize(%q) unexpectedly succeeded", code)
		}
	}
}
