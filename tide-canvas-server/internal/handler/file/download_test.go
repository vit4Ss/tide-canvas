package file

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"tidecanvas/internal/pkg/storage"
)

type ownedURLReaderStub struct {
	body string
	err  error
	url  string
}

func (s *ownedURLReaderStub) OpenURL(_ context.Context, raw string) (io.ReadCloser, error) {
	s.url = raw
	if s.err != nil {
		return nil, s.err
	}
	return io.NopCloser(strings.NewReader(s.body)), nil
}

// 下载名补扩展名：按「结尾是否已是 URL 的扩展名」判定——模型名带版本点号
// （qwen-image-3.0-pro / Hunyuan 3D 3.1）时旧的「无点才补」会吞掉扩展名。
func TestDownloadFilename(t *testing.T) {
	cases := []struct {
		name    string
		urlPath string
		want    string
	}{
		// 版本点号不再抑制补扩展名（本次修复的主场景）
		{"qwen-image-3.0-pro", "/gen/abc.png", "qwen-image-3.0-pro.png"},
		{"Hunyuan 3D 3.1 (Tencent MaaS)", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// 已带同扩展名（含大小写差异）不重复追加
		{"photo.png", "/gen/abc.png", "photo.png"},
		{"photo.PNG", "/gen/abc.png", "photo.PNG"},
		// 前端已拼好扩展名的 3D 下载名，服务端不再二次追加
		{"Hunyuan 3D 3.1 (Tencent MaaS).glb", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// URL 无扩展名时保持原名
		{"qwen-image-3.0-pro", "/gen/abc", "qwen-image-3.0-pro"},
		// 空名回退 download（原有行为）
		{"", "/gen/abc.mp4", "download.mp4"},
		{"", "/gen/abc", "download"},
		// 扩展名不同则按实际字节的格式追加
		{"song.mp3", "/gen/track.wav", "song.mp3.wav"},
	}
	for _, tc := range cases {
		if got := downloadFilename(tc.name, tc.urlPath); got != tc.want {
			t.Errorf("downloadFilename(%q, %q) = %q, want %q", tc.name, tc.urlPath, got, tc.want)
		}
	}
}

func TestTextContainsExactURL(t *testing.T) {
	const target = "https://cdn.example.com/video.mp4"
	for _, content := range []string{
		`![video](https://cdn.example.com/video.mp4)`,
		`![video](https://cdn.example.com/video.mp4 "poster")`,
		`<video src="https://cdn.example.com/video.mp4">`,
	} {
		if !textContainsExactURL(content, target) {
			t.Fatalf("expected exact URL in %q to match", content)
		}
	}
	if textContainsExactURL(`![video](https://cdn.example.com/video.mp4?preview=1)`, target) {
		t.Fatal("must not authorize a URL prefix inside a different URL")
	}
}

func TestOpenOwnedStorageURLBypassesRemoteResolution(t *testing.T) {
	const raw = "https://test-cdn.example/uploads/panorama.png"
	store := &ownedURLReaderStub{body: "panorama-bytes"}
	body, handled, err := openOwnedStorageURL(context.Background(), store, raw)
	if err != nil {
		t.Fatalf("openOwnedStorageURL() error = %v", err)
	}
	if !handled {
		t.Fatal("openOwnedStorageURL() handled = false, want true")
	}
	defer body.Close()
	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read owned body: %v", err)
	}
	if string(got) != store.body {
		t.Fatalf("owned body = %q, want %q", got, store.body)
	}
	if store.url != raw {
		t.Fatalf("OpenURL raw = %q, want %q", store.url, raw)
	}
}

func TestOpenOwnedStorageURLFallsBackOnlyForUnsupportedURL(t *testing.T) {
	store := &ownedURLReaderStub{err: storage.ErrUnsupported}
	body, handled, err := openOwnedStorageURL(context.Background(), store, "https://third-party.example/image.png")
	if body != nil || handled || err != nil {
		t.Fatalf("unsupported result = (%v, %v, %v), want (nil, false, nil)", body, handled, err)
	}

	readErr := errors.New("oss unavailable")
	store.err = readErr
	body, handled, err = openOwnedStorageURL(context.Background(), store, "https://test-cdn.example/image.png")
	if body != nil || !handled || !errors.Is(err, readErr) {
		t.Fatalf("owned read failure = (%v, %v, %v), want (nil, true, %v)", body, handled, err, readErr)
	}
}

func TestContentTypeForDownload(t *testing.T) {
	if got := contentTypeForDownload("/uploads/panorama.png"); got != "image/png" {
		t.Fatalf("PNG content type = %q, want image/png", got)
	}
	if got := contentTypeForDownload("/uploads/file.unknown-extension"); got != "application/octet-stream" {
		t.Fatalf("unknown content type = %q, want application/octet-stream", got)
	}
}
