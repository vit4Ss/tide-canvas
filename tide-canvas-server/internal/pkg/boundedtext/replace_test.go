package boundedtext

import (
	"errors"
	"strings"
	"testing"
)

func TestReplace(t *testing.T) {
	got, err := Replace("{{a}}/{{b}}/{{a}}", 32, "{{a}}", "A", "{{b}}", "BB")
	if err != nil || got != "A/BB/A" {
		t.Fatalf("Replace = %q, %v", got, err)
	}
}

func TestReplaceRejectsExpansionBomb(t *testing.T) {
	template := strings.Repeat("{{prompt}}", 1000)
	if _, err := Replace(template, 1<<20, "{{prompt}}", strings.Repeat("x", 32<<10)); !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("Replace error = %v", err)
	}
}
