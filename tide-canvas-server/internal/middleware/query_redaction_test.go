package middleware

import (
	"strings"
	"testing"
)

func TestRedactQueryForLogsRemovesCapabilitiesAndNestedURLSignatures(t *testing.T) {
	raw := "ticket=secret-jwt&name=video.mp4&url=https%3A%2F%2Fcdn.example%2Fvideo.mp4%3Fsign%3Dsecret%26expires%3D1&api-key=relay-secret"
	got := redactQueryForLogs(raw)
	for _, secret := range []string{"secret-jwt", "sign%3Dsecret", "relay-secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("redacted query leaked %q: %s", secret, got)
		}
	}
	if !strings.Contains(got, "name=video.mp4") || !strings.Contains(got, "%5BREDACTED%5D") {
		t.Fatalf("redacted query lost safe fields or markers: %s", got)
	}
}

func TestRedactQueryForLogsNeverFallsBackToMalformedRawInput(t *testing.T) {
	got := redactQueryForLogs("ticket=%zz-secret")
	if strings.Contains(got, "secret") || got != "[invalid-query-redacted]" {
		t.Fatalf("malformed query was not safely redacted: %q", got)
	}
}

func TestRedactQueryForLogsRedactsMalformedNestedURL(t *testing.T) {
	got := redactQueryForLogs("url=not-an-absolute-url%3Fsign%3Dnested-secret&name=video.mp4")
	if strings.Contains(got, "nested-secret") || !strings.Contains(got, "url=%5BREDACTED%5D") {
		t.Fatalf("malformed nested URL was not safely redacted: %q", got)
	}
}

func TestRedactPathForLogsRemovesRelayDownloadToken(t *testing.T) {
	const secretPath = "/api/social-analysis/downloader/download/temporary-secret-token"
	got := redactPathForLogs(secretPath)
	if strings.Contains(got, "temporary-secret-token") || got != "/api/social-analysis/downloader/download/[REDACTED]" {
		t.Fatalf("download token path was not safely redacted: %q", got)
	}
	if safe := "/api/social-analysis/downloader/platforms"; redactPathForLogs(safe) != safe {
		t.Fatalf("ordinary path was unexpectedly changed: %q", redactPathForLogs(safe))
	}
}
