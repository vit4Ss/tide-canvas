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
