package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/userkey"
)

type userAPIKeyScope struct{}

// WithUserAPIKeyScope keeps integration credentials caller-scoped even when a
// lower layer reloads the account's role from the database. It also applies to
// detached generation workers; it does not depend on a live HTTP session.
func WithUserAPIKeyScope(ctx context.Context) context.Context {
	return context.WithValue(ctx, userAPIKeyScope{}, true)
}

func IsUserAPIKeyRequest(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	restricted, _ := ctx.Value(userAPIKeyScope{}).(bool)
	return restricted
}

// UserAPIKeyAuth is opt-in for integration routes only. It must not be added
// to JWTAuth: an integration key cannot log in or manage accounts/admin data.
func UserAPIKeyAuth(keys *userkey.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if keys == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"message": "集成服务未配置", "type": "service_unavailable"}})
			return
		}
		parts := strings.Fields(c.GetHeader("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": gin.H{"message": "需要有效的 API Key", "type": "invalid_api_key"}})
			return
		}
		owner, revision, err := keys.AuthenticateWithRevision(c.Request.Context(), parts[1])
		if err != nil {
			status, message, kind := http.StatusUnauthorized, "API Key 无效、已停用或账号不可用", "invalid_api_key"
			if !errors.Is(err, userkey.ErrInvalid) {
				status, message, kind = http.StatusServiceUnavailable, "暂时无法校验 API Key", "service_unavailable"
			}
			c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"message": message, "type": kind}})
			return
		}
		c.Set(CtxUserID, owner.ID)
		c.Set(CtxRole, 0) // API keys never inherit an administrator role.
		c.Request = c.Request.WithContext(WithUserAPIKeyScope(c.Request.Context()))
		c.Set("integration.owner", owner)
		c.Set("integration.keyRevision", revision)
		c.Next()
	}
}
