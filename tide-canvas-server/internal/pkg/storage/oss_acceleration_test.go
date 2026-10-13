package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/config"
)

func accelerationTestConfig(enabled bool) config.StorageConfig {
	return config.StorageConfig{
		Type: "oss", Endpoint: "https://oss-cn-shanghai.aliyuncs.com",
		Bucket: "flowlinght", AccessKey: "test-access", SecretKey: "test-secret",
		Prefix: "canvas/uploads", CDNDomain: "https://cdn.example.com",
		AccelerateDomain:        "https://flowlinght.oss-accelerate.aliyuncs.com",
		AccelerateEnabled:       enabled,
		UploadAccelerateEnabled: true,
	}
}

func TestOSSUploadAndUpstreamAccelerationAreIndependent(t *testing.T) {
	for _, test := range []struct {
		name            string
		enabled         bool
		uploadEnabled   bool
		wantUploadHost  string
		wantUpstreamURL string
	}{
		{name: "both enabled", enabled: true, uploadEnabled: true, wantUploadHost: "flowlinght.oss-accelerate.aliyuncs.com", wantUpstreamURL: "https://flowlinght.oss-accelerate.aliyuncs.com/canvas/uploads/u1/ref.png"},
		{name: "legacy disabled", enabled: false, uploadEnabled: true, wantUploadHost: "flowlinght.oss-accelerate.aliyuncs.com", wantUpstreamURL: "https://cdn.example.com/canvas/uploads/u1/ref.png"},
		{name: "uploads disabled", enabled: true, uploadEnabled: false, wantUploadHost: "flowlinght.oss-cn-shanghai.aliyuncs.com", wantUpstreamURL: "https://flowlinght.oss-accelerate.aliyuncs.com/canvas/uploads/u1/ref.png"},
		{name: "both disabled", enabled: false, uploadEnabled: false, wantUploadHost: "flowlinght.oss-cn-shanghai.aliyuncs.com", wantUpstreamURL: "https://cdn.example.com/canvas/uploads/u1/ref.png"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := accelerationTestConfig(test.enabled)
			cfg.UploadAccelerateEnabled = test.uploadEnabled
			store, err := NewOSSStorage(cfg)
			if err != nil {
				t.Fatal(err)
			}
			grant, err := store.Presign(context.Background(), "u1/ref.png", "image/png", 32)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(grant.UploadURL)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Hostname() != test.wantUploadHost {
				t.Fatalf("upload host = %q, want %q", parsed.Hostname(), test.wantUploadHost)
			}
			if parsed.Path != "/canvas/uploads/u1/ref.png" {
				t.Fatalf("upload object path changed: %s", parsed.Path)
			}
			if grant.FileURL != "https://cdn.example.com/canvas/uploads/u1/ref.png" || !grant.Direct || grant.Headers["x-oss-forbid-overwrite"] != "true" {
				t.Fatalf("upload routing changed public URLs or signed-upload protections: %+v", grant)
			}
			regional := "https://flowlinght.oss-cn-shanghai.aliyuncs.com/canvas/uploads/u1/ref.png"
			if got := store.UpstreamURL(regional); got != test.wantUpstreamURL {
				t.Fatalf("UpstreamURL() = %q, want %q", got, test.wantUpstreamURL)
			}
			if _, ok := store.OwnsURL("https://flowlinght.oss-accelerate.aliyuncs.com/canvas/uploads/u1/ref.png"); !ok {
				t.Fatal("configured accelerate host must remain trusted for legacy URLs when the switch is off")
			}
			if !strings.Contains(strings.Join(store.FetchHosts(), ","), "oss-accelerate.aliyuncs.com") {
				t.Fatal("configured accelerate host disappeared from the safe fetch allowlist")
			}
		})
	}
}

func TestOSSUploadAccelerationDerivesCurrentBucketHost(t *testing.T) {
	for _, bucket := range []string{"flowlinght", "flowlinght-test"} {
		cfg := accelerationTestConfig(true)
		cfg.Bucket = bucket
		cfg.AccelerateDomain = ""
		store, err := NewOSSStorage(cfg)
		if err != nil {
			t.Fatal(err)
		}
		grant, err := store.Presign(context.Background(), "u1/ref.png", "image/png", 32)
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := url.Parse(grant.UploadURL)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Scheme != "https" || parsed.Hostname() != bucket+".oss-accelerate.aliyuncs.com" {
			t.Fatalf("wrong acceleration host for %q: %q", bucket, parsed.Host)
		}
		public := "https://cdn.example.com/canvas/uploads/u1/ref.png"
		if store.UpstreamURL(public) != public {
			t.Fatal("an upload-only derived host must not enable upstream rewriting")
		}
		if got, ok := store.OwnsURL("https://" + parsed.Host + parsed.Path); !ok || got != public {
			t.Fatal("derived upload host must be recognized as owned storage")
		}
	}
}

func TestOSSServerUploadUsesAccelerationWhenLegacySwitchIsOff(t *testing.T) {
	type requestInfo struct{ method, path, contentType, body string }
	requests := make(chan requestInfo, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- requestInfo{r.Method, r.URL.Path, r.Header.Get("Content-Type"), string(body)}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	cfg := accelerationTestConfig(false)
	// Only a loopback fake endpoint is used: no real credentials or OSS writes.
	cfg.Endpoint = "http://127.0.0.1:1"
	cfg.AccelerateDomain = server.URL
	store, err := NewOSSStorage(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	public, err := store.Save(ctx, "u1/ref.png", strings.NewReader("png bytes"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if public != "https://cdn.example.com/canvas/uploads/u1/ref.png" {
		t.Fatalf("wrong public URL: %s", public)
	}
	select {
	case got := <-requests:
		// The SDK uses path-style bucket addressing for this loopback IP only.
		if got.method != "PUT" || got.path != "/flowlinght/canvas/uploads/u1/ref.png" || got.contentType != "image/png" || got.body != "png bytes" {
			t.Fatalf("unexpected upload request: %+v", got)
		}
	default:
		t.Fatal("server upload bypassed acceleration endpoint")
	}
}
