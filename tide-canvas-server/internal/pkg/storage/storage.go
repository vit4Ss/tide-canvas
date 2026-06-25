// Package storage abstracts blob persistence behind a StorageStrategy
// interface and ships a filesystem-backed LocalStorage implementation. An OSS
// implementation can satisfy the same interface in a later phase.
package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"tidecanvas/internal/config"
)

// PresignResult describes a direct-to-storage upload grant. For local storage
// direct upload is unsupported, so Direct is false and the caller must fall
// back to a server-mediated upload (matches the frontend's uploadFileSmart).
type PresignResult struct {
	Direct      bool   `json:"direct"`
	UploadURL   string `json:"uploadUrl,omitempty"`
	Key         string `json:"key,omitempty"`
	FileURL     string `json:"fileUrl,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

// StorageStrategy is the storage backend contract.
type StorageStrategy interface {
	// Save persists the reader's contents under key and returns the public URL.
	Save(ctx context.Context, key string, r io.Reader, contentType string) (url string, err error)
	// Delete removes the object identified by key. Missing objects are not an error.
	Delete(ctx context.Context, key string) error
	// URL returns the public URL for a stored key.
	URL(key string) string
	// Presign requests a direct-upload grant. Local storage returns Direct=false.
	Presign(ctx context.Context, key, contentType string) (PresignResult, error)
	// Type reports the storage type identifier ("local" | "oss").
	Type() string
	// UpstreamURL rewrites a public asset URL into the form an overseas upstream
	// supplier (the relay) should fetch — e.g. swapping the regional OSS host for
	// the transfer-acceleration host. Backends that need no rewrite (local) return
	// the URL unchanged.
	UpstreamURL(url string) string
}

// ErrUnsupported is returned by operations a backend cannot perform.
var ErrUnsupported = errors.New("storage: operation not supported")

// New constructs the configured StorageStrategy. Unknown types fall back to
// local so the server stays bootable.
func New(cfg config.StorageConfig) (StorageStrategy, error) {
	switch strings.ToLower(cfg.Type) {
	case "oss":
		return NewOSSStorage(cfg)
	case "", "local":
		return NewLocalStorage(cfg)
	default:
		return NewLocalStorage(cfg)
	}
}

// LocalStorage stores files on the local filesystem rooted at baseDir, exposing
// them under publicURL.
type LocalStorage struct {
	baseDir   string
	publicURL string
}

// NewLocalStorage creates a LocalStorage, ensuring the base directory exists.
func NewLocalStorage(cfg config.StorageConfig) (*LocalStorage, error) {
	dir := cfg.LocalDir
	if dir == "" {
		dir = "./data/uploads"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	pub := strings.TrimRight(cfg.PublicURL, "/")
	if pub == "" {
		pub = "http://localhost:8080/static"
	}
	return &LocalStorage{baseDir: dir, publicURL: pub}, nil
}

// Type returns "local".
func (l *LocalStorage) Type() string { return "local" }

// cleanKey normalizes a storage key into a safe relative path (no traversal).
func cleanKey(key string) string {
	key = strings.TrimLeft(key, "/")
	key = path.Clean("/" + key)
	return strings.TrimLeft(key, "/")
}

// Save writes the reader's bytes to baseDir/key and returns its public URL.
func (l *LocalStorage) Save(ctx context.Context, key string, r io.Reader, contentType string) (string, error) {
	_ = contentType // local storage doesn't persist content-type metadata
	rel := cleanKey(key)
	if rel == "" {
		return "", errors.New("storage: empty key")
	}
	dst := filepath.Join(l.baseDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	f, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", err
	}
	return l.URL(rel), nil
}

// Delete removes the file for key; a non-existent file is treated as success.
func (l *LocalStorage) Delete(ctx context.Context, key string) error {
	rel := cleanKey(key)
	if rel == "" {
		return nil
	}
	dst := filepath.Join(l.baseDir, filepath.FromSlash(rel))
	if err := os.Remove(dst); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// URL returns the public URL for key.
func (l *LocalStorage) URL(key string) string {
	return l.publicURL + "/" + cleanKey(key)
}

// Presign reports that direct upload is unsupported for local storage; the
// caller should perform a server-mediated upload (Direct=false).
func (l *LocalStorage) Presign(ctx context.Context, key, contentType string) (PresignResult, error) {
	return PresignResult{
		Direct:      false,
		Key:         cleanKey(key),
		FileURL:     l.URL(key),
		ContentType: contentType,
	}, nil
}

// UpstreamURL returns the URL unchanged: local assets need no host rewrite (and
// are only reachable on the same host anyway).
func (l *LocalStorage) UpstreamURL(url string) string { return url }
