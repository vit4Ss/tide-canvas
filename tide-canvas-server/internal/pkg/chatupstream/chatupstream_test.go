package chatupstream

import (
	"errors"
	"strings"
	"testing"
)

func TestSealedKeyRoundTripsAndResistsTampering(t *testing.T) {
	v := New("unit-secret")
	sealed, err := v.Seal("sk-live-abc")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "sk-live-abc") {
		t.Fatalf("the credential survives in the stored value: %s", sealed)
	}
	if got, err := v.Open(sealed); err != nil || got != "sk-live-abc" {
		t.Fatalf("round trip failed: %q %v", got, err)
	}
	// A rotated vault secret must fail loudly; the caller then refuses the model
	// rather than falling back to the shared relay.
	if _, err := New("другой").Open(sealed); err == nil {
		t.Fatal("a foreign vault opened the credential")
	}
	for _, broken := range []string{"", "plain-text", "v1:@@@", "v1:" + strings.Repeat("A", 8)} {
		if _, err := v.Open(broken); err == nil {
			t.Fatalf("%q was accepted", broken)
		}
	}
}

func TestTheMaskIsNeverStoredAsACredential(t *testing.T) {
	v := New("unit-secret")
	for _, refused := range []string{"", "   ", Masked, "sk-a\nsk-b", strings.Repeat("k", 4097)} {
		if _, err := v.Seal(refused); err == nil {
			t.Fatalf("%q was sealed as a credential", refused)
		}
	}
}

func TestBaseURLMustBeAPlainHTTPSOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://api.openai.com":            "https://api.openai.com",
		"http://relay.example.com:3000/v1/": "http://relay.example.com:3000/v1",
		"https://api.example.com/":          "https://api.example.com",
		"https://api.example.com/v1/":       "https://api.example.com/v1",
		" https://api.example.com ":         "https://api.example.com",
		"":                                  "",
	} {
		got, err := NormalizeBaseURL(raw)
		if err != nil || got != want {
			t.Fatalf("%q -> %q (%v), want %q", raw, got, err, want)
		}
	}
	for _, refused := range []string{
		"https://user:pass@api.example.com", // credentials in the URL
		"https://api.example.com?token=x",   // query could redirect the call
		"https://api.example.com/../evil",   // traversal
		"ftp://api.example.com",
		"//api.example.com",
		"javascript:alert(1)",
		"https://",
		"https://" + strings.Repeat("a", 512),
	} {
		if _, err := NormalizeBaseURL(refused); err == nil {
			t.Fatalf("%q was accepted as a base URL", refused)
		}
	}
}

// Relays document their base address both ways, and an operator pastes what
// their provider printed. Both must reach the same URL — appending a second
// "/v1" produces an upstream error that reads as "the provider is down".
func TestEndpointDoesNotDoubleTheVersionSegment(t *testing.T) {
	cases := []struct{ base, want string }{
		{"https://ccgoai.club/v1", "https://ccgoai.club/v1/models"},
		{"https://ccgoai.club/v1/", "https://ccgoai.club/v1/models"},
		{"https://ccgoai.club", "https://ccgoai.club/v1/models"},
		{"https://ccgoai.club/", "https://ccgoai.club/v1/models"},
		// A relay mounted under a prefix keeps it; only the version is deduped.
		{"https://host/proxy/openai", "https://host/proxy/openai/v1/models"},
		{"https://host/proxy/openai/v1", "https://host/proxy/openai/v1/models"},
	}
	for _, c := range cases {
		if got := Endpoint(c.base, "models"); got != c.want {
			t.Errorf("Endpoint(%q) = %q, want %q", c.base, got, c.want)
		}
	}
	if got := Endpoint("https://ccgoai.club/v1", "chat/completions"); got != "https://ccgoai.club/v1/chat/completions" {
		t.Errorf("chat path = %q", got)
	}
}

// A well-formed address inside the deployment is refused for a different
// reason than a malformed one, and the caller must be able to tell them apart
// to explain it.
func TestAnInternalAddressIsRefusedDistinctly(t *testing.T) {
	for _, internal := range []string{"http://10.0.0.5:8080", "https://127.0.0.1/v1", "http://[::1]", "https://169.254.169.254"} {
		if _, err := NormalizeBaseURL(internal); !errors.Is(err, ErrInternalHost) {
			t.Errorf("NormalizeBaseURL(%q) = %v, want ErrInternalHost", internal, err)
		}
	}
	if _, err := NormalizeBaseURL("ftp://relay.example.com"); !errors.Is(err, ErrBaseURL) {
		t.Errorf("a non-HTTP scheme was not an ErrBaseURL: %v", err)
	}
}
