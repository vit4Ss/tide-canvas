// Package activationcode contains the secret-handling primitives shared by
// activation-code administration and redemption.
package activationcode

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"unicode"
)

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

var ErrInvalid = errors.New("activation code: invalid format")

// Generate creates a human-friendly FLOW-XXXX-XXXX-XXXX code. The alphabet is
// 32 characters, so indexing a random byte by its low five bits is unbiased.
func Generate() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	for i := range raw {
		raw[i] = alphabet[int(raw[i])&31]
	}
	s := string(raw)
	return "FLOW-" + s[:4] + "-" + s[4:8] + "-" + s[8:], nil
}

// Normalize removes spaces and hyphens, uppercases the input, and rejects any
// other characters. This accepts copied codes with harmless formatting changes
// without widening the valid secret alphabet.
func Normalize(code string) (string, error) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(code) {
		switch {
		case r == '-' || unicode.IsSpace(r):
			continue
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - ('a' - 'A'))
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			return "", ErrInvalid
		}
	}
	normalized := b.String()
	if len(normalized) < 8 || len(normalized) > 64 {
		return "", ErrInvalid
	}
	return normalized, nil
}

func HashNormalized(normalized string) string {
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func Hash(code string) (string, error) {
	normalized, err := Normalize(code)
	if err != nil {
		return "", err
	}
	return HashNormalized(normalized), nil
}

// Hint returns a masked identifier that is safe to persist and display.
func Hint(code string) (string, error) {
	normalized, err := Normalize(code)
	if err != nil {
		return "", err
	}
	return normalized[:4] + "-****-****-" + normalized[len(normalized)-4:], nil
}
