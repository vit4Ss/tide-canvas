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
	saveCalled bool
}

func (s *ownsURLStore) Save(context.Context, string, io.Reader, string) (string, error) {
	s.saveCalled = true
	return "", nil
}
func (s *ownsURLStore) Delete(context.Context, string) error { return nil }
func (s *ownsURLStore) URL(key string) string                { return "https://pub/" + key }
func (s *ownsURLStore) Type() string                         { return "oss" }
func (s *ownsURLStore) UpstreamURL(u string) string          { return u }
func (s *ownsURLStore) FetchHosts() []string                 { return nil }
func (s *ownsURLStore) PublicRewrites() [][2]string          { return nil }
func (s *ownsURLStore) Presign(context.Context, string, string) (storage.PresignResult, error) {
	return storage.PresignResult{}, nil
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
	store := &ownsURLStore{ownURL: src, canonical: want}
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
