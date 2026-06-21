// Package cache wraps the go-redis v9 client and centralizes Redis key
// builders so key formats stay consistent across packages.
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"tidecanvas/internal/config"
)

// New constructs a *redis.Client from config and verifies connectivity.
func New(cfg config.RedisConfig) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("cache: redis ping: %w", err)
	}
	return rdb, nil
}

// Key builders -------------------------------------------------------------
//
// Keep these as the single source of truth for Redis key formats. The token
// package also constructs auth:* keys; the builders here mirror that scheme so
// callers can share them.

// RefreshKey builds the key storing a user's valid refresh-token JTI.
// Format: auth:refresh:{uid}:{jti}
func RefreshKey(uid, jti string) string {
	return fmt.Sprintf("auth:refresh:%s:%s", uid, jti)
}

// RefreshUserPattern matches all refresh keys for a user (e.g. for bulk logout).
func RefreshUserPattern(uid string) string {
	return fmt.Sprintf("auth:refresh:%s:*", uid)
}

// BlacklistKey builds the key marking an access token's JTI as revoked.
// Format: auth:blacklist:{jti}
func BlacklistKey(jti string) string {
	return fmt.Sprintf("auth:blacklist:%s", jti)
}

// EmailCodeKey builds the key holding a one-time email verification code.
// Format: auth:emailcode:{email}
func EmailCodeKey(email string) string {
	return fmt.Sprintf("auth:emailcode:%s", email)
}

// EmailCodeIPKey builds the per-IP send counter used to cap how many codes a
// single client may request within a window.
// Format: auth:emailcode:ip:{ip}
func EmailCodeIPKey(ip string) string {
	return fmt.Sprintf("auth:emailcode:ip:%s", ip)
}

// EmailCodeCooldownKey builds the per-email resend cooldown marker. Its mere
// existence means another send is not yet allowed.
// Format: auth:emailcode:cooldown:{email}
func EmailCodeCooldownKey(email string) string {
	return fmt.Sprintf("auth:emailcode:cooldown:%s", email)
}

// EmailCodeAttemptsKey builds the per-email failed-verification attempt counter
// used to invalidate a code after too many wrong guesses.
// Format: auth:emailcode:attempts:{email}
func EmailCodeAttemptsKey(email string) string {
	return fmt.Sprintf("auth:emailcode:attempts:%s", email)
}

// RateLimitKey builds a token-bucket key scoped by an identifier (e.g. ip:route).
// Format: ratelimit:{scope}
func RateLimitKey(scope string) string {
	return fmt.Sprintf("ratelimit:%s", scope)
}

// AiTaskKey builds the key holding transient AI task state.
// Format: ai:task:{taskID}
func AiTaskKey(taskID string) string {
	return fmt.Sprintf("ai:task:%s", taskID)
}
