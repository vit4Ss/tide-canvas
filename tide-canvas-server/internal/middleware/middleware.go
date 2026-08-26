// Package middleware provides cross-cutting Gin middleware: CORS, request id,
// panic recovery, structured request logging, JWT authentication, admin
// gating, and a basic Redis token-bucket rate limiter.
package middleware

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/alerting"
	"tidecanvas/internal/pkg/eventlog"
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
func Recovery(deps ...*app.Deps) gin.HandlerFunc {
	var alerts *alerting.Service
	if len(deps) > 0 && deps[0] != nil {
		alerts = deps[0].Alerts
	}
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				logger.L().Error("panic recovered",
					zap.Any("error", r),
					zap.String("path", c.FullPath()),
					zap.String("requestID", c.GetString(CtxRequestID)),
				)
				if alerts != nil {
					ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
					_ = alerts.Publish(ctx, alerting.EventInput{
						EventType: "system.http.panic", Category: "system", Severity: alerting.SeverityCritical,
						Fingerprint: "system.http.panic:" + c.FullPath(), Title: "API 请求发生未恢复异常",
						Content: "服务已拦截请求处理过程中的 panic，请管理员检查服务端日志。", Source: "middleware/recovery",
						Details: map[string]any{"method": c.Request.Method, "path": c.FullPath(), "requestId": c.GetString(CtxRequestID), "panic": fmt.Sprint(r)},
					})
					cancel()
				}
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

// AccessLog persists one access_log row per API request (asynchronously, via
// eventlog). It runs in the global chain, so when c.Next() returns JWTAuth has
// already populated the user id for authenticated routes. Non-API, health,
// static and the high-frequency AI task-poll GET are skipped to keep the table
// signal-rich.
func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method
		c.Next()

		if !shouldLogAccess(method, path) {
			return
		}
		eventlog.Access(&model.AccessLog{
			UserID:    CurrentUserID(c),
			Method:    method,
			Path:      eventlog.Truncate(path, 512),
			Query:     eventlog.Truncate(c.Request.URL.RawQuery, 1024),
			Status:    c.Writer.Status(),
			LatencyMs: time.Since(start).Milliseconds(),
			IP:        c.ClientIP(),
			UserAgent: eventlog.Truncate(c.Request.UserAgent(), 512),
			RequestID: c.GetString(CtxRequestID),
		})
	}
}

// shouldLogAccess keeps the access log to meaningful API traffic: only /api/*,
// excluding CORS preflight and the AI task-poll GET the canvas hits every couple
// of seconds.
func shouldLogAccess(method, path string) bool {
	if method == "OPTIONS" {
		return false
	}
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if method == "GET" && strings.HasPrefix(path, "/api/ai/tasks/") {
		return false
	}
	return true
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

// CtxAdminPerms is the context key for the caller's resolved后台模块权限
// (set by AdminAccess, read by AdminPerm). Value type: map[string]bool。
const CtxAdminPerms = "adminPerms"

// adminPermsCache 按 uid 缓存角色解析结果,避免后台每个请求都查 user+sys_role。
// TTL 内角色/权限的后台修改不即时生效(最长延迟 permsCacheTTL),对运营配置
// 场景可接受。
const permsCacheTTL = 30 * time.Second

var (
	adminPermsMu    sync.Mutex
	adminPermsCache = map[idgen.ID]adminPermsEntry{}
)

type adminPermsEntry struct {
	perms   map[string]bool
	expires time.Time
}

// resolveAdminPerms returns the cached后台权限集合 for uid, loading user+role
// from the DB on miss. role=9 走不到这里(AdminAccess 直接放行),所以缓存里
// 只有运营角色用户,量级很小。
func resolveAdminPerms(d *app.Deps, uid idgen.ID) map[string]bool {
	now := time.Now()
	adminPermsMu.Lock()
	if e, ok := adminPermsCache[uid]; ok && now.Before(e.expires) {
		adminPermsMu.Unlock()
		return e.perms
	}
	adminPermsMu.Unlock()

	perms := map[string]bool{}
	var u model.User
	if err := d.DB.Where("id = ?", uid).First(&u).Error; err == nil {
		for _, k := range model.AdminPermsForUser(d.DB, &u) {
			perms[k] = true
		}
	}
	adminPermsMu.Lock()
	adminPermsCache[uid] = adminPermsEntry{perms: perms, expires: now.Add(permsCacheTTL)}
	adminPermsMu.Unlock()
	return perms
}

// AdminAccess gates /api/admin:role=9 超管全量放行;其余用户按其角色
// (sys_role.permissions)解析后台模块权限,持有任一 admin.* 模块键即可进入,
// 具体模块再由 AdminPerm 细分。无任何后台权限 → 403。Must be chained after
// JWTAuth.
func AdminAccess(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := CurrentUserID(c)
		if uid == 0 {
			response.Fail(c, response.CodeUnauthorized, "authentication required")
			c.Abort()
			return
		}
		if CurrentRole(c) == AdminRole {
			// 超管:空集合 + 下方 AdminPerm 对超管直通,无需逐键展开
			c.Set(CtxAdminPerms, map[string]bool(nil))
			c.Next()
			return
		}
		perms := resolveAdminPerms(d, uid)
		if len(perms) == 0 {
			response.Fail(c, response.CodeForbidden, "admin privileges required")
			c.Abort()
			return
		}
		c.Set(CtxAdminPerms, perms)
		c.Next()
	}
}

// AdminPerm requires the caller to hold指定后台模块权限键(如 "admin.models")。
// 超管(role=9)直通;其余按 AdminAccess 解析进 context 的集合判定。
func AdminPerm(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if CurrentRole(c) == AdminRole {
			c.Next()
			return
		}
		v, _ := c.Get(CtxAdminPerms)
		perms, _ := v.(map[string]bool)
		if !perms[key] {
			response.Fail(c, response.CodeForbidden, "module permission required: "+key)
			c.Abort()
			return
		}
		c.Next()
	}
}

// InvalidateAdminPermsCache clears the admin-perms cache。角色权限/用户角色
// 在后台被修改后调用,让变更即时生效(否则最长延迟 permsCacheTTL)。
func InvalidateAdminPermsCache() {
	adminPermsMu.Lock()
	adminPermsCache = map[idgen.ID]adminPermsEntry{}
	adminPermsMu.Unlock()
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
