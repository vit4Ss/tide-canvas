package chatupstream

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	for _, internal := range []string{"https://127.0.0.1/v1", "http://[::1]", "https://169.254.169.254", "http://0.0.0.0:8080", "http://[::ffff:127.0.0.1]"} {
		if _, err := NormalizeBaseURL(internal); !errors.Is(err, ErrInternalHost) {
			t.Errorf("NormalizeBaseURL(%q) = %v, want ErrInternalHost", internal, err)
		}
	}
	// The operator's own network is theirs: a relay on the LAN is ordinary.
	for _, private := range []string{"http://10.0.0.5:8080", "http://192.168.1.10:3000/v1", "https://172.16.0.2"} {
		if _, err := NormalizeBaseURL(private); err != nil {
			t.Errorf("NormalizeBaseURL(%q) refused a private-network relay: %v", private, err)
		}
	}
	if _, err := NormalizeBaseURL("ftp://relay.example.com"); !errors.Is(err, ErrBaseURL) {
		t.Errorf("a non-HTTP scheme was not an ErrBaseURL: %v", err)
	}
}

// A hostname is what a form check cannot see through. The transport resolves it
// and applies the same policy: a name that resolves to this host is refused,
// while a literal address — already vetted when saved — is dialled as written.
func TestTheTransportRefusesNamesThatResolveToThisHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))
	defer server.Close()
	client := &http.Client{Transport: NewTransport(), Timeout: 5 * time.Second}

	if resp, err := client.Get(server.URL); err != nil || resp.StatusCode != 204 {
		t.Fatalf("a literal loopback address (vetted at save time) was not dialled: %v", err)
	}
	// Same server, reached by a name that resolves to loopback.
	byName := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
	if _, err := client.Get(byName); err == nil || !errors.Is(err, ErrInternalHost) {
		t.Fatalf("a hostname resolving to this host was dialled: %v", err)
	}
}

func TestRedirectHintNamesTheAddressToUse(t *testing.T) {
	if got := RedirectHint(301, "https://relay.example.com/v1/chat/completions"); !strings.Contains(got, "https://relay.example.com/v1/chat/completions") || !strings.Contains(got, "https") {
		t.Fatalf("hint = %q", got)
	}
	for status, location := range map[int]string{200: "https://x", 301: "", 404: "https://x"} {
		if got := RedirectHint(status, location); got != "" {
			t.Errorf("RedirectHint(%d, %q) = %q, want none", status, location, got)
		}
	}
}
