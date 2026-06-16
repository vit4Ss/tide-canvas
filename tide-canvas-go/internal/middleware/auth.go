package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// gin.Context 中存放当前用户信息的键。
const (
	ctxUserID   = "currentUserId"
	ctxUsername = "currentUsername"
	ctxRole     = "currentRole"
)

// 管理员角色值（对齐旧后端 sys_user.role=9）。
const RoleAdmin = 9

// JWTAuth 强制鉴权中间件：无有效 access token 则 401（refresh token 不可作为访问凭证）。
func JWTAuth(provider *appjwt.Provider) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := parseToken(c, provider)
		if !ok || claims.Type == appjwt.TypeRefresh {
			abort401(c)
			return
		}
		setUser(c, claims)
		c.Next()
	}
}

// OptionalAuth 可选鉴权：携带有效 token 则注入用户信息，否则放行（用于可选登录的公开接口）。
func OptionalAuth(provider *appjwt.Provider) gin.HandlerFunc {
	return func(c *gin.Context) {
		if claims, ok := parseToken(c, provider); ok && claims.Type != appjwt.TypeRefresh {
			setUser(c, claims)
		}
		c.Next()
	}
}

// AdminOnly 管理员鉴权：须在 JWTAuth 之后使用，要求 role==9。
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if RoleOf(c) != RoleAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false, "code": ecode.Forbidden.Code(), "message": ecode.Forbidden.Message(),
			})
			return
		}
		c.Next()
	}
}

func parseToken(c *gin.Context, provider *appjwt.Provider) (*appjwt.Claims, bool) {
	h := c.GetHeader("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return nil, false
	}
	claims, err := provider.Parse(strings.TrimPrefix(h, "Bearer "))
	if err != nil {
		return nil, false
	}
	return claims, true
}

func setUser(c *gin.Context, claims *appjwt.Claims) {
	if uid, err := claims.UserID(); err == nil {
		c.Set(ctxUserID, uid)
	}
	c.Set(ctxUsername, claims.Username)
	c.Set(ctxRole, claims.Role)
}

func abort401(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"success": false, "code": ecode.Unauthorized.Code(), "message": ecode.Unauthorized.Message(),
	})
}

// CurrentUserID 返回当前用户ID与是否已登录（对齐 SecurityUtils.getCurrentUserId）。
func CurrentUserID(c *gin.Context) (int64, bool) {
	v, ok := c.Get(ctxUserID)
	if !ok {
		return 0, false
	}
	id, ok := v.(int64)
	return id, ok
}

// MustUserID 返回当前用户ID（配合 JWTAuth 使用时必有值，否则为 0）。
func MustUserID(c *gin.Context) int64 {
	id, _ := CurrentUserID(c)
	return id
}

// RoleOf 返回当前用户角色，未知返回 -1。
func RoleOf(c *gin.Context) int {
	if v, ok := c.Get(ctxRole); ok {
		if r, ok := v.(int); ok {
			return r
		}
	}
	return -1
}
