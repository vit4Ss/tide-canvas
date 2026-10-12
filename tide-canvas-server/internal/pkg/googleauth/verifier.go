// Package googleauth verifies Google Identity Services credentials. It reuses
// the application's JWT library and caches Google's rotating public keys.
package googleauth

import (
	"context"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrCredential  = errors.New("invalid Google credential")
	ErrUnavailable = errors.New("Google verification is unavailable")
)

type Identity struct {
	jwt.RegisteredClaims
	Nonce           string `json:"nonce"`
	Email           string `json:"email"`
	EmailVerified   bool   `json:"email_verified"`
	Name            string `json:"name"`
	Picture         string `json:"picture"`
	AuthorizedParty string `json:"azp"`
	HostedDomain    string `json:"hd"`
}

// Google is authoritative for Gmail and verified Workspace addresses. Other
// providers' addresses need a fresh email challenge before account creation.
func (i *Identity) EmailIsAuthoritative() bool {
	return i.EmailVerified && (strings.HasSuffix(i.Email, "@gmail.com") || i.HostedDomain != "")
}

type Verifier struct {
	client     *http.Client
	keysURL    string
	mu         sync.Mutex
	keys       map[string]*rsa.PublicKey
	expires    time.Time
	lastFetch  time.Time
	fetchError error
}

func NewVerifier() *Verifier {
	return &Verifier{client: &http.Client{Timeout: 8 * time.Second}, keysURL: "https://www.googleapis.com/oauth2/v3/certs"}
}

func (v *Verifier) Verify(ctx context.Context, credential, audience, nonce string) (*Identity, error) {
	if audience == "" || len(nonce) != 43 || credential == "" || len(credential) > 16384 {
		return nil, ErrCredential
	}
	claims := &Identity{}
	parsed, err := jwt.ParseWithClaims(credential, claims, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok || kid == "" || len(kid) > 256 {
			return nil, ErrCredential
		}
		return v.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			return nil, ErrUnavailable
		}
		return nil, ErrCredential
	}
	if !parsed.Valid || (claims.Issuer != "accounts.google.com" && claims.Issuer != "https://accounts.google.com") ||
		claims.Subject == "" || len(claims.Subject) > 255 || !claims.EmailVerified ||
		(claims.AuthorizedParty != "" && claims.AuthorizedParty != audience) ||
		subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(nonce)) != 1 {
		return nil, ErrCredential
	}
	claims.Email = strings.ToLower(strings.TrimSpace(claims.Email))
	address, err := mail.ParseAddress(claims.Email)
	if err != nil || address.Address != claims.Email || len(claims.Email) > 128 {
		return nil, ErrCredential
	}
	return claims, nil
}

func (v *Verifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	if now.Before(v.expires) {
		if key := v.keys[kid]; key != nil {
			return key, nil
		}
	}
	// Untrusted key IDs must not turn the login endpoint into a JWKS fetch loop.
	if v.fetchError != nil && now.Sub(v.lastFetch) < 2*time.Second {
		return nil, ErrUnavailable
	}
	if v.fetchError == nil && v.keys[kid] == nil && now.Sub(v.lastFetch) < 30*time.Second {
		return nil, ErrCredential
	}
	v.lastFetch = now
	v.fetchError = ErrUnavailable
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.keysURL, nil)
	if err != nil {
		return nil, ErrUnavailable
	}
	res, err := v.client.Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	var set struct {
		Keys []struct {
			ID        string `json:"kid"`
			Type      string `json:"kty"`
			Algorithm string `json:"alg"`
			Use       string `json:"use"`
			N         string `json:"n"`
			E         string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&set); err != nil {
		return nil, ErrUnavailable
	}
	keys := make(map[string]*rsa.PublicKey)
	for _, item := range set.Keys {
		if item.Type != "RSA" || item.Algorithm != "RS256" || item.Use != "sig" {
			continue
		}
		n, nErr := base64.RawURLEncoding.DecodeString(item.N)
		e, eErr := base64.RawURLEncoding.DecodeString(item.E)
		if nErr != nil || eErr != nil || len(e) == 0 || len(e) > 4 {
			continue
		}
		exponent := 0
		for _, b := range e {
			exponent = exponent*256 + int(b)
		}
		modulus := new(big.Int).SetBytes(n)
		if modulus.BitLen() < 2048 || exponent < 3 || exponent%2 == 0 {
			continue
		}
		keys[item.ID] = &rsa.PublicKey{N: modulus, E: exponent}
	}
	if len(keys) == 0 {
		return nil, ErrUnavailable
	}
	duration := cacheDuration(res.Header.Get("Cache-Control"))
	if age, err := strconv.Atoi(res.Header.Get("Age")); err == nil && age > 0 {
		if age >= int(duration/time.Second) {
			duration = 0
		} else {
			duration -= time.Duration(age) * time.Second
		}
	}
	if duration < 0 {
		duration = 0
	}
	v.keys, v.expires, v.fetchError = keys, time.Now().Add(duration), nil
	if key := keys[kid]; key != nil {
		return key, nil
	}
	return nil, ErrCredential
}

func cacheDuration(header string) time.Duration {
	for _, part := range strings.Split(header, ",") {
		if directive := strings.ToLower(strings.TrimSpace(part)); directive == "no-cache" || directive == "no-store" {
			return 0
		}
	}
	for _, part := range strings.Split(header, ",") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || !strings.EqualFold(name, "max-age") {
			continue
		}
		seconds, err := strconv.Atoi(strings.Trim(value, "\""))
		if err == nil && seconds >= 0 && seconds <= 86400 {
			return time.Duration(seconds) * time.Second
		}
	}
	return 10 * time.Minute
}
