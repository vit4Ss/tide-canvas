// Package middleware provides cross-cutting Gin middleware: CORS, request id,
// panic recovery, structured request logging, JWT authentication, admin
// gating, and a basic Redis token-bucket rate limiter.
package middleware

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

// Context keys used to stash authenticated identity. Handlers read these.
const (
	CtxUserID    = "userID"    // idgen.ID
	CtxRole      = "role"      // int
	CtxJTI       = "jti"       // string
	CtxRequestID = "requestID" // string
	HeaderReqID  = "X-Request-Id"
)

// AdminRole is the role value granting admin access (matches frontend UserRole.ADMIN).
const AdminRole = 9

// CORS allows the configured frontend origin(s) with credentials. Allowed
// origins come from d.Cfg.CORS.AllowOrigins (defaults to localhost:3000).
func CORS(d *app.Deps) gin.HandlerFunc {
	allowed := map[string]struct{}{}
	if d != nil && d.Cfg != nil {
		for _, o := range d.Cfg.CORS.AllowOrigins {
			allowed[o] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		allowed["http://localhost:3000"] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if _, ok := allowed[origin]; ok {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
				c.Header("Access-Control-Allow-Credentials", "true")
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
				c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-Request-Id")
				c.Header("Access-Control-Expose-Headers", "X-Request-Id, ETag")
				c.Header("Access-Control-Max-Age", "86400")
			}
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// RequestID ensures every request has an X-Request-Id (incoming or generated)
// and exposes it via context and the response header.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(HeaderReqID)
		if rid == "" {
			rid = idgen.Next().String()
		}
		c.Set(CtxRequestID, rid)
		c.Header(HeaderReqID, rid)
		c.Next()
	}
}

// Recovery recovers from panics and responds with a 500 failure envelope.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				logger.L().Error("panic recovered",
					zap.Any("error", r),
					zap.String("path", c.FullPath()),
					zap.String("requestID", c.GetString(CtxRequestID)),
				)
				if !c.Writer.Written() {
					response.Fail(c, response.CodeServerError, "internal server error")
				}
				c.Abort()
			}
		}()
		c.Next()
	}
}

// ZapLogger logs each request with method, path, status and latency.
func ZapLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery
		c.Next()
		latency := time.Since(start)
		if raw != "" {
			path = path + "?" + raw
		}
		logger.L().Info("request",
			zap.String("method", c.Request.Method),
			zap.String("path", path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", latency),
			zap.String("ip", c.ClientIP()),
			zap.String("requestID", c.GetString(CtxRequestID)),
		)
	}
}

// JWTAuth validates the Bearer access token (signature, expiry, blacklist) and
// stores userID/role/jti in the context. On any failure it writes a 401 body
// (so the frontend triggers a refresh) and aborts.
func JWTAuth(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		authz := c.GetHeader("Authorization")
		if authz == "" || !strings.HasPrefix(authz, "Bearer ") {
			response.Fail(c, response.CodeUnauthorized, "missing or invalid authorization header")
			c.Abort()
			return
		}
		raw := strings.TrimSpace(strings.TrimPrefix(authz, "Bearer "))
		if raw == "" {
			response.Fail(c, response.CodeUnauthorized, "missing access token")
			c.Abort()
			return
		}
		claims, err := token.ParseAccess(raw)
		if err != nil {
			response.Fail(c, response.CodeUnauthorized, "invalid or expired access token")
			c.Abort()
			return
		}
		c.Set(CtxUserID, claims.UserID)
		c.Set(CtxRole, claims.Role)
		c.Set(CtxJTI, claims.JTI)
		c.Next()
	}
}

// AdminOnly requires the authenticated user to have the admin role (9). Must be
// chained after JWTAuth.
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, ok := c.Get(CtxRole)
		if !ok {
			response.Fail(c, response.CodeUnauthorized, "authentication required")
			c.Abort()
			return
		}
		if r, _ := role.(int); r != AdminRole {
			response.Fail(c, response.CodeForbidden, "admin privileges required")
			c.Abort()
			return
		}
		c.Next()
	}
}

// CurrentUserID returns the authenticated user's ID from context (0 if absent).
func CurrentUserID(c *gin.Context) idgen.ID {
	if v, ok := c.Get(CtxUserID); ok {
		if id, ok := v.(idgen.ID); ok {
			return id
		}
	}
	return 0
}

// CurrentRole returns the authenticated user's role from context (0 if absent).
func CurrentRole(c *gin.Context) int {
	if v, ok := c.Get(CtxRole); ok {
		if r, ok := v.(int); ok {
			return r
		}
	}
	return 0
}

// RateLimit applies a basic Redis token-bucket: at most `limit` requests per
// `window` per client IP+route. If Redis is unavailable the request is allowed
// (fail-open). The bucket uses INCR + first-hit EXPIRE.
func RateLimit(d *app.Deps, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if d == nil || d.RDB == nil || limit <= 0 {
			c.Next()
			return
		}
		scope := c.ClientIP() + ":" + c.FullPath()
		key := "ratelimit:" + scope
		ctx := c.Request.Context()

		cnt, err := d.RDB.Incr(ctx, key).Result()
		if err != nil {
			c.Next() // fail-open
			return
		}
		if cnt == 1 {
			_ = d.RDB.Expire(ctx, key, window).Err()
		}
		if cnt > int64(limit) {
			ttl, _ := d.RDB.TTL(ctx, key).Result()
			if ttl > 0 {
				c.Header("Retry-After", strconv.Itoa(int(ttl.Seconds())))
			}
			response.Fail(c, response.CodeRateLimited, "too many requests")
			c.Abort()
			return
		}
		c.Next()
	}
}
