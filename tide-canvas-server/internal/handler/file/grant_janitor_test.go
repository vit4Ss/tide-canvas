package file

import (
	"testing"
	"time"
)

func TestUploadGrantCleanupCutoffKeepsGraceWindow(t *testing.T) {
	now := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	cutoff := uploadGrantCleanupCutoff(now)
	if !now.Add(-time.Minute).After(cutoff) {
		t.Fatal("a just-expired signature would be eligible during the grace window")
	}
	if !now.Add(-3 * time.Minute).Before(cutoff) {
		t.Fatal("a grant older than the grace window would not be eligible")
	}
}
