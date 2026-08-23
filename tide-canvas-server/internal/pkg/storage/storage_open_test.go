package storage

import (
	"bytes"
	"context"
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
