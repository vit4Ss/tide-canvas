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
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// Masked is what an operator sees in place of a stored key. It is also refused
// as input, so re-saving a form without retyping the key cannot store the mask.
const Masked = "••••••••"

var ErrKey = errors.New("chatupstream: unusable credential")
var ErrBaseURL = errors.New("chatupstream: base URL must be an http(s) origin without credentials or query")

// ErrInternalHost is a well-formed address that points at the host itself or
// at the link-local range where cloud metadata services live. It is kept apart
// from ErrBaseURL because the operator needs a different answer: not "fix the
// format" but "this is refused on purpose".
//
// Private networks (10/8, 172.16/12, 192.168/16, fc00::/7) are allowed. A
// relay on the operator's own LAN is an ordinary place for one to be, and the
// operator's network is theirs. What is refused is the machine this service
// runs on — an admin with the models permission could otherwise reach every
// port bound to loopback — and 169.254/16, where a cloud provider hands out
// the instance's own credentials to anything that asks.
var ErrInternalHost = errors.New("chatupstream: base URL points at this host or the link-local range")

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
	// Plain http is accepted. Many relays only speak it, and over it the
	// operator's key travels in the clear — that is the operator's risk to
	// take, and the admin page says so next to such an address, rather than
	// something a gateway should forbid on their behalf.
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(parsed.Path, "..") {
		return "", ErrBaseURL
	}
	// An operations admin holds this form, not only the owner, so a literal
	// address inside the deployment is refused: it would turn "fetch models"
	// into a probe of the private network with the reply handed back.
	if ip, ipErr := netip.ParseAddr(parsed.Hostname()); ipErr == nil && isForbiddenIP(ip) {
		return "", ErrInternalHost
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

// isForbiddenIP is the address policy behind ErrInternalHost. See its comment.
func isForbiddenIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast()
}

// NewTransport dials providers under the same policy NormalizeBaseURL applies
// to literal addresses, extended to what a hostname resolves to. A literal IP
// was vetted when the address was saved and is dialled as written. A hostname
// is resolved here and refused if any answer is a forbidden address — that is
// the half a form check cannot see, and the way a saved-looking name is turned
// into a request against this host or the metadata service.
//
// Both callers — model discovery and the chat gateway — use this, so an address
// behaves the same in the admin page and in a conversation. Callers set their
// own timeouts and redirect policy on the client.
func NewTransport() *http.Transport {
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if _, literal := netip.ParseAddr(host); literal == nil {
			return dialer.DialContext(ctx, network, address)
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, errors.New("chatupstream: hostname has no addresses")
		}
		for _, ip := range ips {
			if isForbiddenIP(ip) {
				return nil, ErrInternalHost
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].Unmap().String(), port))
	}
	return transport
}

// RedirectHint turns a provider's redirect into something the operator can act
// on. Redirects are not followed — a credential must not ride along to wherever
// a relay points — and a bare "HTTP 301" says nothing. The usual cause is an
// address entered as http that the relay only serves over https.
func RedirectHint(status int, location string) string {
	if status < 300 || status > 399 || strings.TrimSpace(location) == "" {
		return ""
	}
	return fmt.Sprintf("模型服务要求跳转到 %s，请把接入地址改为该地址（多半是 http 要改成 https）", strings.TrimSpace(location))
}
