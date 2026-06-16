package middleware

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// 字段截断上限（path/query 对齐 access_log 列宽与旧 AccessLogInterceptor；UA 上限 512）。
const (
	maxLogPath = 255
	maxLogText = 512
)

// 静态资源后缀：这些请求不记访问日志（噪声大、无统计价值）。
var staticSuffixes = []string{
	".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
	".webp", ".woff", ".woff2", ".ttf", ".eot", ".map",
}

// AccessLog 访问日志中间件工厂（对齐旧后端 AccessLogInterceptor + AccessLogRecorder）。
//
// 每个请求记录 method/path/query/status/duration_ms/ip/user_agent/user_id/username，
// 在请求处理完成后异步（goroutine）落库 access_log，写入失败不影响请求本身。
// 跳过 /health 与静态资源；user_id/username 取自鉴权中间件注入的上下文（须置于 OptionalAuth/JWTAuth 之后）。
//
// db 为注入的 *gorm.DB；logger 可为 nil。
func AccessLog(db *gorm.DB, logger *logrus.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if skipAccessLog(path) {
			c.Next()
			return
		}

		start := time.Now()
		c.Next()

		// 在派发 goroutine 前取齐所有字段：请求结束后不可再并发访问 *gin.Context。
		entry := &model.AccessLog{
			Method:    c.Request.Method,
			Path:      truncate(path, maxLogPath),
			Query:     truncate(c.Request.URL.RawQuery, maxLogText),
			IP:        ClientIP(c),
			UserAgent: truncate(c.Request.UserAgent(), maxLogText),
		}
		status := c.Writer.Status()
		entry.Status = &status
		duration := time.Since(start).Milliseconds()
		entry.DurationMs = &duration
		if uid, ok := CurrentUserID(c); ok {
			entry.UserID = &uid
		}
		if v, ok := c.Get(ctxUsername); ok {
			if username, ok := v.(string); ok {
				entry.Username = username
			}
		}

		go saveAccessLog(db, logger, entry)
	}
}

// saveAccessLog 异步落库；失败仅告警，不影响请求（对齐 AccessLogRecorder.save 的 try/catch）。
func saveAccessLog(db *gorm.DB, logger *logrus.Logger, entry *model.AccessLog) {
	defer func() {
		if r := recover(); r != nil && logger != nil {
			logger.Warnf("记录访问日志 panic: %v", r)
		}
	}()
	if err := db.Create(entry).Error; err != nil && logger != nil {
		logger.Warnf("记录访问日志失败: %v", err)
	}
}

// skipAccessLog 判断是否跳过：健康检查与静态资源不记录。
func skipAccessLog(path string) bool {
	if path == "/health" {
		return true
	}
	lower := strings.ToLower(path)
	for _, suf := range staticSuffixes {
		if strings.HasSuffix(lower, suf) {
			return true
		}
	}
	return false
}

// truncate 截断字符串到 max（按字节，对齐旧 substring(0,max)）。
func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}
