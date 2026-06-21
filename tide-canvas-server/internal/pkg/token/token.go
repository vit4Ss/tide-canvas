// Package token issues and validates JWT access/refresh tokens (HS256), and
// manages a Redis-backed refresh-token store and access-token blacklist.
//
// The signing secret and TTLs come from config. Init MUST be called once at
// startup (from app/main wiring) to provide the secret, TTLs and the Redis
// client used by the store/blacklist helpers.
package token

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/idgen"
)

// Errors returned by parsing/validation.
var (
	ErrInvalidToken    = errors.New("token: invalid token")
	ErrExpiredToken    = errors.New("token: token expired")
	ErrNotInitialized  = errors.New("token: package not initialized")
	ErrRefreshNotFound = errors.New("token: refresh token not found or revoked")
	ErrBlacklisted     = errors.New("token: access token revoked")
)

// Token type marker stored in the claims to distinguish access vs refresh.
const (
	typeAccess  = "access"
	typeRefresh = "refresh"
)

// Claims is the JWT payload for both access and refresh tokens.
type Claims struct {
	UserID idgen.ID `json:"uid"`
	Role   int      `json:"role"`
	JTI    string   `json:"jti"`
	Typ    string   `json:"typ"`
	jwt.RegisteredClaims
}

// pkg-level state initialized by Init.
var (
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	issuer     string
	rdb        *redis.Client
)

// Init configures the package from JWT config and a Redis client. Call once at
// startup before issuing or parsing tokens.
func Init(cfg config.JWTConfig, client *redis.Client) {
	secret = []byte(cfg.Secret)
	accessTTL = cfg.AccessTTL
	refreshTTL = cfg.RefreshTTL
	issuer = cfg.Issuer
	if issuer == "" {
		issuer = "tidecanvas"
	}
	if accessTTL <= 0 {
		accessTTL = 2 * time.Hour
	}
	if refreshTTL <= 0 {
		refreshTTL = 7 * 24 * time.Hour
	}
	rdb = client
}

// Issue creates a new access+refresh token pair for the user. The refresh
// token's JTI is recorded in Redis so it can later be validated/revoked.
// expiresIn is the access-token lifetime in seconds.
func Issue(uid idgen.ID, role int) (access string, refresh string, expiresIn int64, err error) {
	if len(secret) == 0 {
		return "", "", 0, ErrNotInitialized
	}
	now := time.Now()
	accessJTI := idgen.Next().String()
	refreshJTI := idgen.Next().String()

	access, err = signToken(uid, role, accessJTI, typeAccess, now, accessTTL)
	if err != nil {
		return "", "", 0, err
	}
	refresh, err = signToken(uid, role, refreshJTI, typeRefresh, now, refreshTTL)
	if err != nil {
		return "", "", 0, err
	}

	// Record the refresh JTI so refresh validation can confirm it's live.
	if rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if e := rdb.Set(ctx, cache.RefreshKey(uid.String(), refreshJTI), "1", refreshTTL).Err(); e != nil {
			return "", "", 0, e
		}
	}

	return access, refresh, int64(accessTTL.Seconds()), nil
}

func signToken(uid idgen.ID, role int, jti, typ string, now time.Time, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID: uid,
		Role:   role,
		JTI:    jti,
		Typ:    typ,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   uid.String(),
			ID:        jti,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(secret)
}

// ParseAccess validates an access token's signature/expiry and checks the
// blacklist. It returns the claims on success.
func ParseAccess(tokenStr string) (*Claims, error) {
	claims, err := parse(tokenStr, typeAccess)
	if err != nil {
		return nil, err
	}
	if rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		n, e := rdb.Exists(ctx, cache.BlacklistKey(claims.JTI)).Result()
		if e == nil && n > 0 {
			return nil, ErrBlacklisted
		}
	}
	return claims, nil
}

// ParseRefresh validates a refresh token's signature/expiry and confirms the
// JTI is still present in the Redis refresh store.
func ParseRefresh(tokenStr string) (*Claims, error) {
	claims, err := parse(tokenStr, typeRefresh)
	if err != nil {
		return nil, err
	}
	if rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		n, e := rdb.Exists(ctx, cache.RefreshKey(claims.UserID.String(), claims.JTI)).Result()
		if e != nil {
			return nil, e
		}
		if n == 0 {
			return nil, ErrRefreshNotFound
		}
	}
	return claims, nil
}

func parse(tokenStr, wantType string) (*Claims, error) {
	if len(secret) == 0 {
		return nil, ErrNotInitialized
	}
	claims := &Claims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}
	if !tok.Valid {
		return nil, ErrInvalidToken
	}
	if claims.Typ != wantType {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// RevokeAccess adds an access token's JTI to the blacklist until its natural
// expiry. ttl should be the remaining lifetime; if non-positive, a short
// default is used so the entry self-cleans.
func RevokeAccess(jti string, ttl time.Duration) error {
	if rdb == nil {
		return nil
	}
	if ttl <= 0 {
		ttl = time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return rdb.Set(ctx, cache.BlacklistKey(jti), "1", ttl).Err()
}

// RevokeRefresh removes a single refresh JTI from the store (used on logout /
// rotation).
func RevokeRefresh(uid idgen.ID, jti string) error {
	if rdb == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return rdb.Del(ctx, cache.RefreshKey(uid.String(), jti)).Err()
}

// RevokeAllRefresh removes every refresh token for a user (full logout).
func RevokeAllRefresh(uid idgen.ID) error {
	if rdb == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	iter := rdb.Scan(ctx, 0, cache.RefreshUserPattern(uid.String()), 100).Iterator()
	var keys []string
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	return rdb.Del(ctx, keys...).Err()
}

// RemainingTTL returns how long until the claims expire, clamped at >= 0.
func (c *Claims) RemainingTTL() time.Duration {
	if c.ExpiresAt == nil {
		return 0
	}
	d := time.Until(c.ExpiresAt.Time)
	if d < 0 {
		return 0
	}
	return d
}
