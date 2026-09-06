package lobehub

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/middleware"
)

// LobeHub proxies every user's request from the same server IP. Scope the
// gateway rate limit to the authenticated account, and return an OpenAI error
// with HTTP 429 rather than the main UI's HTTP-200 business envelope.
func (s *service) gatewayRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if s.d.RDB == nil {
			c.Next()
			return
		}
		key := "ratelimit:lobehub:" + middleware.CurrentUserID(c).String() + ":" + c.FullPath()
		const script = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
return {count, redis.call('PTTL', KEYS[1])}`
		result, err := s.d.RDB.Eval(c.Request.Context(), script, []string{key}).Slice()
		if err == nil && len(result) == 2 {
			count, _ := result[0].(int64)
			if count > 120 {
				ttl, _ := result[1].(int64)
				seconds := (ttl + 999) / 1000
				if seconds < 1 {
					seconds = 1
				}
				c.Header("Retry-After", strconv.FormatInt(seconds, 10))
				gatewayError(c, 429, "rate_limit_exceeded", "请求过于频繁，请稍后重试")
				c.Abort()
				return
			}
		}
		// Redis rate limiting is best-effort. The database-backed points, daily
		// quota and concurrency reservations remain authoritative on Redis failure.
		c.Next()
	}
}
