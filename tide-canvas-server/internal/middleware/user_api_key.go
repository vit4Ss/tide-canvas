package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/userkey"
)

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
		owner, err := keys.Authenticate(c.Request.Context(), parts[1])
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
		c.Set("integration.owner", owner)
		c.Next()
	}
}
