package safefetch

import (
	"net/netip"
	"testing"
)

func TestValidateURL(t *testing.T) {
	for _, raw := range []string{
		"https://cdn.example.com/result.png",
		"http://203.0.113.10/file.mp4",
		"https://cdn.example.com:443/a",
	} {
		if _, err := ValidateURL(raw); err != nil {
			t.Fatalf("ValidateURL(%q): %v", raw, err)
		}
	}
	for _, raw := range []string{
		"http://127.0.0.1/private",
		"http://169.254.169.254/latest/meta-data/",
		"http://10.0.0.1/a",
		"https://cdn.example.com:8443/a",
		"file:///etc/passwd",
		"https://user:pass@cdn.example.com/a",
	} {
		if _, err := ValidateURL(raw); err == nil {
			t.Fatalf("ValidateURL(%q) accepted unsafe URL", raw)
		}
	}
}

func TestIsPublicIP(t *testing.T) {
	for raw, want := range map[string]bool{
		"8.8.8.8":         true,
		"127.0.0.1":       false,
		"10.0.0.1":        false,
		"100.64.0.1":      false,
		"169.254.169.254": false,
		"::1":             false,
		"fc00::1":         false,
	} {
		if got := IsPublicIP(netip.MustParseAddr(raw)); got != want {
			t.Fatalf("IsPublicIP(%s) = %v, want %v", raw, got, want)
		}
	}
}
