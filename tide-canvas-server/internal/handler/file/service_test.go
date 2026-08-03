package file

import (
	"net/netip"
	"testing"

	"tidecanvas/internal/pkg/idgen"
)

func TestAssetCategoryForFile(t *testing.T) {
	tests := []struct {
		name     string
		hint     string
		fileType string
		want     string
		wantErr  bool
	}{
		{name: "character image", hint: "character", fileType: "image", want: assetCategoryCharacter},
		{name: "scene image", hint: " SCENE ", fileType: "image", want: assetCategoryScene},
		{name: "empty defaults general", hint: "", fileType: "image", want: assetCategoryGeneral},
		{name: "unknown rejected", hint: "portrait", fileType: "image", wantErr: true},
		{name: "character video rejected", hint: "character", fileType: "video", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := assetCategoryForFile(tt.hint, tt.fileType)
			if (err != nil) != tt.wantErr {
				t.Fatalf("assetCategoryForFile(%q, %q) error = %v, wantErr %v", tt.hint, tt.fileType, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("assetCategoryForFile(%q, %q) = %q, want %q", tt.hint, tt.fileType, got, tt.want)
			}
		})
	}
}

func TestClassifyPrefersPhysicalMediaEvidence(t *testing.T) {
	if got := classify("image", "video/mp4", "clip.mp4"); got != "video" {
		t.Fatalf("classify spoofed image hint = %q, want video", got)
	}
	if got := classify("video", "image/png", "portrait.png"); got != "image" {
		t.Fatalf("classify spoofed video hint = %q, want image", got)
	}
}

func TestActiveContentRejected(t *testing.T) {
	blocked := []struct {
		contentType string
		name        string
	}{
		{"text/html; charset=utf-8", "page.bin"},
		{"image/svg+xml", "drawing.svg"},
		{"application/octet-stream", "payload.js"},
		{"text/plain", "document.xhtml"},
	}
	for _, item := range blocked {
		if !activeContentRejected(item.contentType, item.name) {
			t.Fatalf("activeContentRejected(%q, %q) = false, want true", item.contentType, item.name)
		}
	}
	for _, item := range []struct {
		contentType string
		name        string
	}{{"image/png", "portrait.png"}, {"video/mp4", "clip.mp4"}, {"application/pdf", "brief.pdf"}} {
		if activeContentRejected(item.contentType, item.name) {
			t.Fatalf("activeContentRejected(%q, %q) = true, want false", item.contentType, item.name)
		}
	}
}

func TestValidateRemoteAssetURL(t *testing.T) {
	valid := []string{
		"https://cdn.example.com/assets/result.png",
		"http://203.0.113.8/image.png",
		"https://cdn.example.com:443/video.mp4?token=abc",
	}
	for _, raw := range valid {
		if _, err := validateRemoteAssetURL(raw); err != nil {
			t.Fatalf("validateRemoteAssetURL(%q) unexpected error: %v", raw, err)
		}
	}

	invalid := []string{
		"file:///etc/passwd",
		"https://user:pass@example.com/a.png",
		"http://127.0.0.1/admin",
		"http://[::1]/admin",
		"http://169.254.169.254/latest/meta-data",
		"https://cdn.example.com:8443/a.png",
	}
	for _, raw := range invalid {
		if _, err := validateRemoteAssetURL(raw); err == nil {
			t.Fatalf("validateRemoteAssetURL(%q) = nil error, want rejection", raw)
		}
	}
}

func TestIsPublicRemoteIP(t *testing.T) {
	tests := map[string]bool{
		"8.8.8.8":         true,
		"1.1.1.1":         true,
		"10.0.0.1":        false,
		"100.64.0.1":      false,
		"127.0.0.1":       false,
		"169.254.169.254": false,
		"172.16.0.1":      false,
		"192.168.1.1":     false,
		"198.18.0.1":      false,
		"::1":             false,
		"fc00::1":         false,
		"fe80::1":         false,
	}
	for raw, want := range tests {
		if got := isPublicRemoteIP(netip.MustParseAddr(raw)); got != want {
			t.Fatalf("isPublicRemoteIP(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestOwnedStorageKey(t *testing.T) {
	owner := idgen.ID(12345)
	valid := "uploads/image/2026/08/12345/98765.png"
	if got, ok := ownedStorageKey(owner, valid); !ok || got != valid {
		t.Fatalf("ownedStorageKey(valid) = %q, %v", got, ok)
	}
	for _, raw := range []string{
		"uploads/image/2026/08/99999/98765.png",
		"uploads/image/2026/08/12345/../secret.png",
		"/uploads/image/2026/08/12345/98765.png",
		"uploads/image/not-a-year/08/12345/98765.png",
	} {
		if _, ok := ownedStorageKey(owner, raw); ok {
			t.Fatalf("ownedStorageKey(%q) accepted an unsafe key", raw)
		}
	}
}

func TestJSONContainsExactString(t *testing.T) {
	raw := `{"tracks":[{"url":"https://cdn.example/a.mp3"}],"cover":"https://cdn.example/c.jpg"}`
	if !jsonContainsExactString(raw, "https://cdn.example/a.mp3") {
		t.Fatal("expected nested URL match")
	}
	if jsonContainsExactString(raw, "https://cdn.example/a") {
		t.Fatal("substring must not count as ownership")
	}
}
