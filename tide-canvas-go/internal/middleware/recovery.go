package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Recovery 捕获 panic，统一返回 500（对齐旧后端 GlobalExceptionHandler 的兜底）。
func Recovery(logger *logrus.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				if logger != nil {
					logger.Errorf("panic recovered: %v | %s %s", err, c.Request.Method, c.Request.URL.Path)
				}
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"success": false, "code": ecode.ServerError.Code(), "message": ecode.ServerError.Message(),
				})
			}
		}()
		c.Next()
	}
}
