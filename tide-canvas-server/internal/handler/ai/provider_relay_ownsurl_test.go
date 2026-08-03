package ai

import (
	"context"
	"io"
	"testing"

	"tidecanvas/internal/pkg/storage"
)

// ownsURLStore is a StorageStrategy fake whose OwnsURL answers yes for one URL;
// Save fails the test if reached — the whole point of the fast path is that no
// download/upload happens for relay results already written into our directory.
type ownsURLStore struct {
	ownURL     string
	canonical  string
	urlBase    string
	saveCalled bool
}

func (s *ownsURLStore) Save(context.Context, string, io.Reader, string) (string, error) {
	s.saveCalled = true
	return "", nil
}
func (s *ownsURLStore) Delete(context.Context, string) error { return nil }
func (s *ownsURLStore) URL(key string) string {
	base := s.urlBase
	if base == "" {
		base = "https://pub"
	}
	return base + "/" + key
}
func (s *ownsURLStore) Type() string                { return "oss" }
func (s *ownsURLStore) UpstreamURL(u string) string { return u }
func (s *ownsURLStore) FetchHosts() []string        { return nil }
func (s *ownsURLStore) PublicRewrites() [][2]string { return nil }
func (s *ownsURLStore) Presign(context.Context, string, string, int64) (storage.PresignResult, error) {
	return storage.PresignResult{}, nil
}
func (s *ownsURLStore) Stat(context.Context, string) (storage.ObjectMeta, error) {
	return storage.ObjectMeta{}, nil
}
func (s *ownsURLStore) OwnsURL(u string) (string, bool) {
	if u == s.ownURL {
		return s.canonical, true
	}
	return "", false
}

// saveRemote must short-circuit URLs the relay already wrote into our bucket
// directory (apikey storage_prefix): no fetch, no Save, canonical URL out.
func TestSaveRemoteSkipsRehostForOwnURL(t *testing.T) {
	const src = "https://scaecrowtoken.oss-accelerate.aliyuncs.com/canvas/uploads/u1/up_1_task.png"
	const want = "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploads/u1/up_1_task.png"
	store := &ownsURLStore{
		ownURL:    src,
		canonical: want,
		urlBase:   "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploads",
	}
	p := &relayProviderClient{store: store}

	got, err := p.saveRemote(context.Background(), src)
	if err != nil {
		t.Fatalf("saveRemote: %v", err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if store.saveCalled {
		t.Fatal("Save must not be called for an already-owned URL")
	}
}

func TestStrictOwnedRelayURLRejectsNonCanonicalOwnedResult(t *testing.T) {
	store := &ownsURLStore{
		ownURL:    "https://accelerate.example/canvas/uploads/u1/result.png",
		canonical: "https://pub/other/../private/result.png",
		urlBase:   "https://pub/canvas/uploads",
	}
	if got, ok := strictOwnedRelayURL(store, store.ownURL); ok || got != "" {
		t.Fatalf("traversal-shaped canonical URL accepted: %q", got)
	}

	store.canonical = "https://pub/canvas/uploads/u1/result.png?token=secret"
	if got, ok := strictOwnedRelayURL(store, store.ownURL); ok || got != "" {
		t.Fatalf("canonical URL with query accepted: %q", got)
	}
}

// A URL NOT under our prefix (e.g. relay's own uploads/ dir, or an upstream
// CDN) must still go through fetch + Save. Use an unroutable address: the
// fetch fails, proving the fast path did NOT claim it.
func TestSaveRemoteFallsThroughForForeignURL(t *testing.T) {
	store := &ownsURLStore{ownURL: "https://owned.example/x.png", canonical: "https://pub/x.png"}
	p := &relayProviderClient{store: store}

	_, err := p.saveRemote(context.Background(), "http://127.0.0.1:1/unreachable.png")
	if err == nil {
		t.Fatal("want fetch error for foreign URL (fast path must not claim it)")
	}
	if store.saveCalled {
		t.Fatal("Save must not be called when the fetch failed")
	}
}

func TestNormalizeRehostContentTypeRejectsActiveContent(t *testing.T) {
	for _, raw := range []string{"text/html", "image/svg+xml", "application/javascript"} {
		if _, err := normalizeRehostContentType(raw, "https://cdn.example.com/result.bin"); err == nil {
			t.Fatalf("normalizeRehostContentType(%q) accepted active content", raw)
		}
	}
	if got, err := normalizeRehostContentType("application/octet-stream", "https://cdn.example.com/result.mp4"); err != nil || got != "video/mp4" {
		t.Fatalf("octet-stream mp4 = %q, %v", got, err)
	}
	if ext := mediaExt("https://cdn.example.com/payload.html", "image/png"); ext != ".png" {
		t.Fatalf("active URL extension survived rehost: %q", ext)
	}
}
