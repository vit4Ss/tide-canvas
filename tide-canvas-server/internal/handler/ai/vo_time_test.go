package ai

import (
	"testing"
	"time"
)

func TestFmtTimeIncludesSourceOffset(t *testing.T) {
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	got := fmtTime(time.Date(2026, 8, 12, 3, 4, 5, 0, shanghai))
	if want := "2026-08-12T03:04:05+08:00"; got != want {
		t.Fatalf("fmtTime() = %q, want %q", got, want)
	}
}

func TestFmtTimeKeepsZeroValueEmpty(t *testing.T) {
	if got := fmtTime(time.Time{}); got != "" {
		t.Fatalf("fmtTime(zero) = %q, want empty", got)
	}
}
