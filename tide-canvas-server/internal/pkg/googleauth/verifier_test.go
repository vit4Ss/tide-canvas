package googleauth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestVerifyGoogleCredential(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kid": "fixture-key", "kty": "RSA", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	}))
	defer server.Close()
	v := NewVerifier()
	v.keysURL = server.URL
	v.client = server.Client()
	const audience = "fixture.apps.googleusercontent.com"
	nonce := strings.Repeat("a", 43)
	base := func() Identity {
		return Identity{RegisteredClaims: jwt.RegisteredClaims{Issuer: "https://accounts.google.com", Subject: "google-subject", Audience: jwt.ClaimStrings{audience}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}, Nonce: nonce, Email: "Creator@example.com", EmailVerified: true, AuthorizedParty: audience}
	}
	for _, tc := range []struct {
		name   string
		mutate func(*Identity)
		valid  bool
	}{
		{"valid", func(c *Identity) {}, true},
		{"legacy issuer", func(c *Identity) { c.Issuer = "accounts.google.com" }, true},
		{"wrong audience", func(c *Identity) { c.Audience = jwt.ClaimStrings{"other-client"} }, false},
		{"wrong issuer", func(c *Identity) { c.Issuer = "https://attacker.example" }, false},
		{"expired", func(c *Identity) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute)) }, false},
		{"missing expiration", func(c *Identity) { c.ExpiresAt = nil }, false},
		{"wrong nonce", func(c *Identity) { c.Nonce = strings.Repeat("b", 43) }, false},
		{"missing subject", func(c *Identity) { c.Subject = "" }, false},
		{"unverified email", func(c *Identity) { c.EmailVerified = false }, false},
		{"email with display name", func(c *Identity) { c.Email = "Person <creator@example.com>" }, false},
		{"wrong authorized party", func(c *Identity) { c.AuthorizedParty = "other-client" }, false},
		{"future issued at", func(c *Identity) { c.IssuedAt = jwt.NewNumericDate(time.Now().Add(time.Hour)) }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := base()
			tc.mutate(&claims)
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, &claims)
			token.Header["kid"] = "fixture-key"
			credential, err := token.SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			identity, err := v.Verify(context.Background(), credential, audience, nonce)
			if tc.valid {
				if err != nil || identity.Email != "creator@example.com" {
					t.Fatalf("valid credential: %v", err)
				}
			} else if !errors.Is(err, ErrCredential) {
				t.Fatalf("invalid credential accepted: %v", err)
			}
		})
	}
	if calls.Load() != 1 {
		t.Fatalf("JWKS cache fetched %d times", calls.Load())
	}
	claims := base()
	for _, method := range []jwt.SigningMethod{jwt.SigningMethodHS256, jwt.SigningMethodNone} {
		token := jwt.NewWithClaims(method, &claims)
		token.Header["kid"] = "fixture-key"
		var secret any = []byte("untrusted-secret")
		if method == jwt.SigningMethodNone {
			secret = jwt.UnsafeAllowNoneSignatureType
		}
		credential, _ := token.SignedString(secret)
		if _, err := v.Verify(context.Background(), credential, audience, nonce); !errors.Is(err, ErrCredential) {
			t.Fatalf("unsafe method accepted: %v", err)
		}
	}
	wrongKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, &claims)
	token.Header["kid"] = "fixture-key"
	credential, _ := token.SignedString(wrongKey)
	if _, err := v.Verify(context.Background(), credential, audience, nonce); !errors.Is(err, ErrCredential) {
		t.Fatal("forged signature accepted")
	}
	token.Header["kid"] = "unknown-key"
	credential, _ = token.SignedString(key)
	for range 3 {
		_, _ = v.Verify(context.Background(), credential, audience, nonce)
	}
	if calls.Load() != 1 {
		t.Fatal("unknown key IDs bypassed JWKS fetch limit")
	}
	// A short positive cache TTL must refresh a known key immediately on expiry.
	v.expires = time.Now().Add(-time.Second)
	if _, err := v.key(context.Background(), "fixture-key"); err != nil {
		t.Fatalf("expired known key was rejected by negative-cache throttle: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatal("expired key did not refresh")
	}
}

func TestGoogleCacheDirectives(t *testing.T) {
	for _, header := range []string{"max-age=0", "Max-Age=0", "no-cache", "public,max-age=3600,no-store", "max-age=3600, no-cache"} {
		if got := cacheDuration(header); got != 0 {
			t.Fatalf("cache directive %q: %s", header, got)
		}
	}
}

func TestVerificationOutage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	v := NewVerifier()
	v.keysURL = server.URL
	v.client = server.Client()
	if _, err := v.key(context.Background(), "key"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("outage: %v", err)
	}
	if _, err := v.key(context.Background(), "key"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("cached outage was misreported as an invalid credential: %v", err)
	}
}
