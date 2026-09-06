// Package chatupstream holds the optional per-model upstream for AI chat: a
// model may talk to its own OpenAI-compatible endpoint instead of the shared
// relay. Only the AI chat gateway consults it; generation and the studio model
// catalogue are unaffected.
//
// The key is sealed rather than stored in the model's config blob, because that
// blob is served to every signed-in client (the studio catalogue and the public
// model list strip only errorHints from it).
package chatupstream

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/netip"
	"net/url"
	"strings"

	"tidecanvas/internal/pkg/safefetch"
)

// Masked is what an operator sees in place of a stored key. It is also refused
// as input, so re-saving a form without retyping the key cannot store the mask.
const Masked = "••••••••"

var ErrKey = errors.New("chatupstream: unusable credential")
var ErrBaseURL = errors.New("chatupstream: base URL must be an https origin without credentials or query")

type Vault struct{ key [32]byte }

func New(secret string) Vault {
	return Vault{key: sha256.Sum256([]byte("tidecanvas-chat-upstream:" + secret))}
}

func (v Vault) gcm() (cipher.AEAD, error) {
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func (v Vault) Seal(apiKey string) (string, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || apiKey == Masked || len(apiKey) > 4096 || strings.ContainsAny(apiKey, "\r\n") {
		return "", ErrKey
	}
	gcm, err := v.gcm()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return "v1:" + base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(apiKey), nil)), nil
}

func (v Vault) Open(sealed string) (string, error) {
	if !strings.HasPrefix(sealed, "v1:") {
		return "", ErrKey
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(sealed, "v1:"))
	if err != nil {
		return "", ErrKey
	}
	gcm, err := v.gcm()
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", ErrKey
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		// A rotated vault secret must not silently fall back to the shared
		// relay: the caller reports the model as misconfigured instead.
		return "", ErrKey
	}
	return string(plain), nil
}

// NormalizeBaseURL accepts the origin (optionally with a path prefix) that the
// OpenAI-compatible endpoint lives under, and returns it without a trailing
// slash. It refuses anything that could redirect the key somewhere unintended.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > 512 {
		return "", ErrBaseURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(parsed.Path, "..") {
		return "", ErrBaseURL
	}
	// An operations admin holds this form, not only the owner, so a literal
	// address inside the deployment is refused: it would turn "fetch models"
	// into a probe of the private network with the reply handed back.
	if ip, ipErr := netip.ParseAddr(parsed.Hostname()); ipErr == nil && !safefetch.IsPublicIP(ip) {
		return "", ErrBaseURL
	}
	return strings.TrimRight(parsed.Scheme+"://"+parsed.Host+parsed.Path, "/"), nil
}

// Endpoint builds an OpenAI-style URL under a provider's base address.
//
// Providers document that address both ways — "https://host" and
// "https://host/v1" — and an operator pastes whichever their provider printed.
// Appending "/v1" unconditionally turns the second form into "/v1/v1/models",
// which the upstream answers with an error that looks like the provider is
// down. So the version segment is added only when it is not already there.
func Endpoint(baseURL, path string) string {
	base := strings.TrimRight(baseURL, "/")
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	return base + "/" + strings.TrimLeft(path, "/")
}
