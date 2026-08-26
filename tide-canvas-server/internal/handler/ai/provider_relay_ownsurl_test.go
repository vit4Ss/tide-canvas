package ai

import (
	"context"
	"io"
	"sync"
	"testing"

	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

// ownsURLStore is a StorageStrategy fake whose OwnsURL answers yes for one URL;
// Save fails the test if reached — the whole point of the fast path is that no
// download/upload happens for relay results already written into our directory.
type ownsURLStore struct {
	ownURL     string
	canonical  string
	urlBase    string
	ownedURLs  map[string]string
	saveCalled bool
	mu         sync.Mutex
	ownsCalls  map[string]int
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
	s.mu.Lock()
	if s.ownsCalls == nil {
		s.ownsCalls = make(map[string]int)
	}
	s.ownsCalls[u]++
	s.mu.Unlock()
	if canonical, ok := s.ownedURLs[u]; ok {
		return canonical, true
	}
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

func TestNormalize3DRehostContentType(t *testing.T) {
	tests := []struct {
		raw       string
		assetType string
		want      string
	}{
		{"application/octet-stream", "GLB", "model/gltf-binary"},
		{"text/plain; charset=utf-8", "obj", "model/obj"},
		{"model/stl", ".STL", "model/stl"},
		{"application/zip", "usdz", "model/vnd.usdz+zip"},
		{"application/octet-stream", "fbx", "application/octet-stream"},
		{"application/gzip", "spz-500k", "application/octet-stream"},
	}
	for _, test := range tests {
		got, err := normalize3DRehostContentType(test.raw, "https://cdn.example/model", test.assetType)
		if err != nil || got != test.want {
			t.Errorf("normalize3DRehostContentType(%q, %q) = %q, %v; want %q", test.raw, test.assetType, got, err, test.want)
		}
	}
	for _, test := range []struct {
		raw       string
		assetType string
	}{
		{"text/html", "glb"},
		{"application/javascript", "obj"},
		{"application/octet-stream", "dae"},
	} {
		if _, err := normalize3DRehostContentType(test.raw, "https://cdn.example/model", test.assetType); err == nil {
			t.Errorf("normalize3DRehostContentType(%q, %q) accepted unsafe/unsupported input", test.raw, test.assetType)
		}
	}
}

func TestResultPersistsOwned3DAssets(t *testing.T) {
	const (
		sourceModel   = "https://relay.example/model.glb?q-sign=temporary"
		sourceOBJ     = "https://relay.example/model.obj?q-sign=temporary"
		sourcePreview = "https://relay.example/preview.png?q-sign=temporary"
		storedModel   = "https://pub/canvas/uploads/u1/model.glb"
		storedOBJ     = "https://pub/canvas/uploads/u1/model.obj"
		storedPreview = "https://pub/canvas/uploads/u1/preview.png"
	)
	store := &ownsURLStore{
		urlBase: "https://pub/canvas/uploads",
		ownedURLs: map[string]string{
			sourceModel:   storedModel,
			sourceOBJ:     storedOBJ,
			sourcePreview: storedPreview,
		},
	}
	p := &relayProviderClient{store: store}
	result, err := p.result(context.Background(), relaymedia.Result{
		URLs: []string{sourceModel, sourceOBJ},
		Assets: []relaymedia.Asset{
			{Type: "glb", URL: sourceModel, PreviewImageURL: sourcePreview},
			{Type: "obj", URL: sourceOBJ, PreviewImageURL: sourcePreview},
		},
	}, nil)
	if err != nil {
		t.Fatalf("result: %v", err)
	}
	if result.ResultURL != storedModel || len(result.URLs) != 2 || result.URLs[0] != storedModel || result.URLs[1] != storedOBJ {
		t.Fatalf("durable primary URLs not mapped: ResultURL=%q URLs=%v", result.ResultURL, result.URLs)
	}
	assets, ok := result.Meta["assets"].([]map[string]any)
	if !ok || len(assets) != 2 {
		t.Fatalf("unexpected assets metadata: %#v", result.Meta["assets"])
	}
	if assets[0]["url"] != storedModel || assets[1]["url"] != storedOBJ ||
		assets[0]["previewImageUrl"] != storedPreview || assets[1]["previewImageUrl"] != storedPreview {
		t.Fatalf("3D asset URLs were not persisted: %#v", assets)
	}
	store.mu.Lock()
	previewOwnsCalls := store.ownsCalls[sourcePreview]
	store.mu.Unlock()
	if previewOwnsCalls != 1 {
		t.Fatalf("shared preview rehosted %d times, want exactly once", previewOwnsCalls)
	}
	if store.saveCalled {
		t.Fatal("Save must not run for files already written to our storage")
	}
}
