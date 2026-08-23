package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"tidecanvas/internal/config"
)

func accelerationTestConfig(enabled bool) config.StorageConfig {
	return config.StorageConfig{
		Type: "oss", Endpoint: "https://oss-cn-shanghai.aliyuncs.com",
		Bucket: "flowlinght", AccessKey: "test-access", SecretKey: "test-secret",
		Prefix: "canvas/uploads", CDNDomain: "https://cdn.example.com",
		AccelerateDomain:  "https://flowlinght.oss-accelerate.aliyuncs.com",
		AccelerateEnabled: enabled,
	}
}

func TestOSSAccelerationSwitchControlsPresignAndUpstreamHost(t *testing.T) {
	for _, test := range []struct {
		name            string
		enabled         bool
		wantUploadHost  string
		wantUpstreamURL string
	}{
		{name: "enabled", enabled: true, wantUploadHost: "flowlinght.oss-accelerate.aliyuncs.com", wantUpstreamURL: "https://flowlinght.oss-accelerate.aliyuncs.com/canvas/uploads/u1/ref.png"},
		{name: "disabled", enabled: false, wantUploadHost: "flowlinght.oss-cn-shanghai.aliyuncs.com", wantUpstreamURL: "https://cdn.example.com/canvas/uploads/u1/ref.png"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, err := NewOSSStorage(accelerationTestConfig(test.enabled))
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
