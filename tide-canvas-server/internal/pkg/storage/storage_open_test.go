package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"tidecanvas/internal/config"
)

func TestLocalStorageOpenReadsOwnedObjectWithoutPublicHTTP(t *testing.T) {
	store, err := NewLocalStorage(config.StorageConfig{LocalDir: t.TempDir(), PublicURL: "https://cdn.invalid/static"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(context.Background(), "uploads/user/reference.png", bytes.NewBufferString("image-bytes"), "image/png"); err != nil {
		t.Fatal(err)
	}
	stream, err := store.Open(context.Background(), "uploads/user/reference.png")
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(stream)
	_ = stream.Close()
	if err != nil || string(data) != "image-bytes" {
		t.Fatalf("opened data = %q, err = %v", data, err)
	}
}

func TestLocalStorageOpenURLValidatesNamespace(t *testing.T) {
	store, err := NewLocalStorage(config.StorageConfig{LocalDir: t.TempDir(), PublicURL: "https://cdn.invalid/static"})
	if err != nil {
		t.Fatal(err)
	}
	url, err := store.Save(context.Background(), "uploads/user/report.docx", bytes.NewBufferString("docx-bytes"), "application/octet-stream")
	if err != nil {
		t.Fatal(err)
	}
	stream, err := store.OpenURL(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	data, readErr := io.ReadAll(stream)
	_ = stream.Close()
	if readErr != nil || string(data) != "docx-bytes" {
		t.Fatalf("opened data = %q, err=%v", data, readErr)
	}
	for _, raw := range []string{
		"https://foreign.invalid/static/uploads/user/report.docx",
		"https://cdn.invalid/static/../report.docx",
		"https://cdn.invalid/static/uploads/user/report.docx?download=1",
	} {
		if _, err := store.OpenURL(context.Background(), raw); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("unsafe URL %q error=%v", raw, err)
		}
	}
}

// StatURL 补齐「生成结果没有 files 行、大小只能问存储」这条链路：归属判定必须
// 与 OpenURL 同口径，外站 URL 与越权路径一律 ErrUnsupported。
func TestLocalStorageStatURLReportsSizeForOwnedObjectsOnly(t *testing.T) {
	store, err := NewLocalStorage(config.StorageConfig{LocalDir: t.TempDir(), PublicURL: "https://cdn.invalid/static"})
	if err != nil {
		t.Fatal(err)
	}
	body := "generated-image-bytes"
	url, err := store.Save(context.Background(), "gen/abc123.png", bytes.NewBufferString(body), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	meta, err := store.StatURL(context.Background(), url)
	if err != nil {
		t.Fatalf("StatURL(%q): %v", url, err)
	}
	if meta.Size != int64(len(body)) {
		t.Fatalf("size = %d, want %d", meta.Size, len(body))
	}
	for _, raw := range []string{
		"https://foreign.invalid/static/gen/abc123.png",
		"https://cdn.invalid/static/../gen/abc123.png",
	} {
		if _, err := store.StatURL(context.Background(), raw); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("unsafe URL %q error=%v, want ErrUnsupported", raw, err)
		}
	}
}
