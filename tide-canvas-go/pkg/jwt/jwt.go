// Package jwt JWT 令牌签发与校验，对齐旧后端 JwtTokenProvider（HS256，access/refresh 分层）。
package jwt

import (
	"errors"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

// 令牌类型（对齐旧后端 claim "type"）。
const (
	TypeAccess  = "access"
	TypeRefresh = "refresh"
)

// Claims 自定义声明：access 携带 username/role，refresh 仅 subject。
type Claims struct {
	Username string `json:"username,omitempty"`
	Role     int    `json:"role,omitempty"`
	Type     string `json:"type"`
	jwt.RegisteredClaims
}

// Provider 令牌提供者。
type Provider struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewProvider 创建提供者。accessTTLSeconds / refreshTTLSeconds 单位为秒。
func NewProvider(secret string, accessTTLSeconds, refreshTTLSeconds int64) *Provider {
	return &Provider{
		secret:     []byte(secret),
		accessTTL:  time.Duration(accessTTLSeconds) * time.Second,
		refreshTTL: time.Duration(refreshTTLSeconds) * time.Second,
	}
}

// GenerateAccessToken 生成访问令牌。
func (p *Provider) GenerateAccessToken(userID int64, username string, role int) (string, error) {
	now := time.Now()
	claims := Claims{
		Username: username,
		Role:     role,
		Type:     TypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(p.accessTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(p.secret)
}

// GenerateRefreshToken 生成刷新令牌。
func (p *Provider) GenerateRefreshToken(userID int64) (string, error) {
	now := time.Now()
	claims := Claims{
		Type: TypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(p.refreshTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(p.secret)
}

// Parse 解析并校验签名与有效期。
func (p *Provider) Parse(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return p.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// UserID 从声明解析用户ID。
func (c *Claims) UserID() (int64, error) {
	return strconv.ParseInt(c.Subject, 10, 64)
}

// AccessTTL 返回访问令牌有效期（秒），供登录响应回传 expiresIn。
func (p *Provider) AccessTTL() int64 { return int64(p.accessTTL.Seconds()) }

// RefreshTTL 返回刷新令牌有效期（秒），供 Cookie max-age 使用。
func (p *Provider) RefreshTTL() int64 { return int64(p.refreshTTL.Seconds()) }
