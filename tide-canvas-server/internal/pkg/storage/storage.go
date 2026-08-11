// Package storage abstracts blob persistence behind a StorageStrategy
// interface and ships a filesystem-backed LocalStorage implementation. An OSS
// implementation can satisfy the same interface in a later phase.
package storage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"tidecanvas/internal/config"
)

// ScopeID returns a non-secret fingerprint of the physical storage namespace.
// Direct-upload grants persist it so a grant minted for one bucket/prefix can
// never be registered or garbage-collected through a later storage config.
// Credentials and public/CDN domains are deliberately excluded.
func ScopeID(cfg config.StorageConfig) string {
	typ := strings.ToLower(strings.TrimSpace(cfg.Type))
	var identity string
	switch typ {
	case "oss":
		identity = strings.Join([]string{
			"oss",
			strings.TrimRight(strings.ToLower(strings.TrimSpace(cfg.Endpoint)), "/"),
			strings.ToLower(strings.TrimSpace(cfg.Bucket)),
			strings.Trim(strings.TrimSpace(cfg.Prefix), "/"),
		}, "\x00")
	default:
		typ = "local"
		identity = strings.Join([]string{"local", filepath.Clean(strings.TrimSpace(cfg.LocalDir))}, "\x00")
	}
	sum := sha256.Sum256([]byte(identity))
	return fmt.Sprintf("%s:%x", typ, sum)
}

// PresignResult describes a direct-to-storage upload grant. For local storage
// direct upload is unsupported, so Direct is false and the caller must fall
// back to a server-mediated upload (matches the frontend's uploadFileSmart).
type PresignResult struct {
	Direct      bool   `json:"direct"`
	UploadURL   string `json:"uploadUrl,omitempty"`
	Key         string `json:"key,omitempty"`
	FileURL     string `json:"fileUrl,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	// Headers are mandatory request headers covered by the storage signature.
	// Callers must forward every entry when uploading to UploadURL.
	Headers map[string]string `json:"headers,omitempty"`
}

// ObjectMeta is authoritative metadata read from the storage service after a
// direct upload. It must never be populated from browser-provided values.
type ObjectMeta struct {
	Size        int64
	ContentType string
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
	Presign(ctx context.Context, key, contentType string, expectedSize int64) (PresignResult, error)
	// Stat verifies that a directly uploaded object exists and reports its
	// server-observed size and content type before it is registered as an asset.
	Stat(ctx context.Context, key string) (ObjectMeta, error)
	// Type reports the storage type identifier ("local" | "oss").
	Type() string
	// UpstreamURL rewrites a public asset URL into the form an overseas upstream
	// supplier (the relay) should fetch — e.g. swapping the regional OSS host for
	// the transfer-acceleration host. Backends that need no rewrite (local) return
	// the URL unchanged.
	UpstreamURL(url string) string
	// FetchHosts returns the hosts that serve this backend's assets (public/CDN
	// host, regional and acceleration hosts for OSS). Server-side fetchers use it
	// as the self-site SSRF allowlist (see pkg/chatattach).
	FetchHosts() []string
	// OwnsURL reports whether url already points at an object inside this
	// backend's own namespace (a serving host from FetchHosts AND the project
	// prefix, for OSS). When it does, it also returns the canonical public URL
	// for that object (host normalized to the current public base, query
	// dropped) so callers can persist a clean display URL instead of whatever
	// host variant they were handed. The relay uses this to skip re-hosting
	// results it wrote directly into our directory (apikey storage_prefix).
	OwnsURL(url string) (canonical string, ok bool)
	// PublicRewrites returns [from→to] base-URL pairs the response layer rewrites
	// on the way out, so asset URLs persisted under any older base (regional,
	// acceleration, or configured legacy hosts) are always served on the current
	// public base (CDN). Signed upload URLs are safe despite the acceleration
	// host being a rewrite source: they are only ever emitted by the presign
	// route, which the middleware exempts as a whole. Empty when no rewriting
	// is needed.
	PublicRewrites() [][2]string
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
func (l *LocalStorage) Presign(ctx context.Context, key, contentType string, expectedSize int64) (PresignResult, error) {
	_ = expectedSize
	return PresignResult{
		Direct:      false,
		Key:         cleanKey(key),
		FileURL:     l.URL(key),
		ContentType: contentType,
	}, nil
}

// Stat reports local object metadata. Direct uploads are disabled for local
// storage, but implementing the contract keeps the backend interchangeable.
func (l *LocalStorage) Stat(ctx context.Context, key string) (ObjectMeta, error) {
	_ = ctx
	rel := cleanKey(key)
	if rel == "" {
		return ObjectMeta{}, errors.New("storage: empty key")
	}
	info, err := os.Stat(filepath.Join(l.baseDir, filepath.FromSlash(rel)))
	if err != nil {
		return ObjectMeta{}, err
	}
	return ObjectMeta{Size: info.Size()}, nil
}

// UpstreamURL returns the URL unchanged: local assets need no host rewrite (and
// are only reachable on the same host anyway).
func (l *LocalStorage) UpstreamURL(url string) string { return url }

// FetchHosts returns the host of the local public URL prefix.
func (l *LocalStorage) FetchHosts() []string { return hostsOf(l.publicURL) }

// OwnsURL matches URLs already under the local public prefix; they are
// canonical by construction, so they are returned unchanged.
func (l *LocalStorage) OwnsURL(u string) (string, bool) {
	key, ok := ownedObjectKey(u, []string{l.publicURL}, "")
	if !ok {
		return "", false
	}
	return canonicalObjectURL(l.publicURL, key)
}

// DeleteURL removes an object only when the URL belongs to this configured
// storage namespace. It is intentionally optional (not part of
// StorageStrategy) so external test doubles and integrations remain compatible.
func (l *LocalStorage) DeleteURL(ctx context.Context, raw string) error {
	key, ok := ownedObjectKey(raw, []string{l.publicURL}, "")
	if !ok {
		return nil
	}
	return l.Delete(ctx, key)
}

// PublicRewrites returns nil: local assets are served from a single stable
// prefix, nothing to normalize.
func (l *LocalStorage) PublicRewrites() [][2]string { return nil }

// hostsOf extracts the host (with port) from each base URL, skipping empties
// and unparseable entries.
func hostsOf(bases ...string) []string {
	var out []string
	seen := map[string]bool{}
	for _, b := range bases {
		if u, err := url.Parse(b); err == nil && u.Host != "" && !seen[u.Host] {
			seen[u.Host] = true
			out = append(out, u.Host)
		}
	}
	return out
}

// ownedObjectKey validates a URL before it is trusted as a same-storage object.
// It deliberately rejects query-bearing and non-canonical paths: OwnsURL is a
// security boundary used to skip an HTTP fetch, so host-prefix string matching
// is not sufficient (userinfo, encoded traversal and repeated slashes are all
// ambiguous at proxies/object stores).
func ownedObjectKey(raw string, bases []string, namespace string) (string, bool) {
	// ParseRequestURI treats a literal '#' in some absolute request targets as
	// path data, so Fragment remains empty and the URL can slip through this
	// canonicality boundary. Parse the absolute URL form directly instead.
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	decoded, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil || decoded == "" || decoded[0] != '/' || decoded != path.Clean(decoded) || strings.Contains(decoded, "\\") {
		return "", false
	}

	namespace = strings.Trim(namespace, "/")
	for _, rawBase := range bases {
		base, err := url.Parse(strings.TrimSpace(rawBase))
		if err != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") || !strings.EqualFold(parsed.Host, base.Host) {
			continue
		}
		candidatePath := decoded
		basePath := strings.TrimSuffix(base.Path, "/")
		if basePath != "" {
			if candidatePath == basePath || !strings.HasPrefix(candidatePath, basePath+"/") {
				continue
			}
			candidatePath = strings.TrimPrefix(candidatePath, basePath)
		}
		key := strings.TrimPrefix(candidatePath, "/")
		if key == "" {
			continue
		}
		if namespace != "" && key != namespace && !strings.HasPrefix(key, namespace+"/") {
			continue
		}
		// A namespace itself is a directory, not an object.
		if key == namespace && namespace != "" {
			continue
		}
		return key, true
	}
	return "", false
}

func canonicalObjectURL(rawBase, key string) (string, bool) {
	base, err := url.Parse(strings.TrimSpace(rawBase))
	if err != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") {
		return "", false
	}
	base.User = nil
	base.RawQuery = ""
	base.Fragment = ""
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + strings.TrimLeft(key, "/")
	base.RawPath = ""
	return base.String(), true
}
