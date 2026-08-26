package alerting

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

const maskedSecret = "••••••••"

type vault struct{ key [32]byte }

func newVault(secret string) vault {
	return vault{key: sha256.Sum256([]byte("tidecanvas-alert:" + secret))}
}

func (v vault) seal(cfg ChannelConfig) (string, error) {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return "v1:" + base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, raw, nil)), nil
}

func (v vault) open(value string) (ChannelConfig, error) {
	var cfg ChannelConfig
	if !strings.HasPrefix(value, "v1:") {
		return cfg, errors.New("unsupported alert credential envelope")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, "v1:"))
	if err != nil {
		return cfg, err
	}
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return cfg, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return cfg, errors.New("invalid alert credential envelope")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return cfg, err
	}
	err = json.Unmarshal(plain, &cfg)
	return cfg, err
}

func maskedConfig(cfg ChannelConfig) ChannelConfig {
	if cfg.Webhook != "" {
		cfg.Webhook = maskEndpoint(cfg.Webhook)
	}
	if cfg.Secret != "" {
		cfg.Secret = maskedSecret
	}
	if cfg.BotToken != "" {
		cfg.BotToken = maskedSecret
	}
	if cfg.ChatID != "" {
		cfg.ChatID = maskEndpoint(cfg.ChatID)
	}
	return cfg
}

func mergeMaskedConfig(next, old ChannelConfig) ChannelConfig {
	if strings.Contains(next.Webhook, "••") {
		next.Webhook = old.Webhook
	}
	if next.Secret == maskedSecret {
		next.Secret = old.Secret
	}
	if next.BotToken == maskedSecret {
		next.BotToken = old.BotToken
	}
	if strings.Contains(next.ChatID, "••") {
		next.ChatID = old.ChatID
	}
	return next
}

func maskEndpoint(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 8 {
		return maskedSecret
	}
	return value[:4] + "••••" + value[len(value)-4:]
}
