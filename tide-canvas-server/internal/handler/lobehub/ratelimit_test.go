package lobehub

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
)

type limitRedisHook struct{ counts map[string]int64 }

func (h *limitRedisHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h *limitRedisHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (h *limitRedisHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		key := cmd.Args()[3].(string)
		h.counts[key]++
		cmd.(*redis.Cmd).SetVal([]any{h.counts[key], int64(1200)})
		return nil
	}
}

func TestGatewayRateLimitSeparatesUsersBehindSameIP(t *testing.T) {
	f := setup(t, "", "")
	f.s.d.RDB = redis.NewClient(&redis.Options{})
	defer f.s.d.RDB.Close()
	f.s.d.RDB.AddHook(&limitRedisHook{counts: map[string]int64{}})
	r := gin.New()
	r.Use(func(c *gin.Context) {
		uid := f.user.ID
		if c.GetHeader("Test-User") == "other" {
			uid = idgen.ID(int64(uid) + 1)
		}
		c.Set(middleware.CtxUserID, uid)
	})
	r.GET("/models", f.s.gatewayRateLimit(), func(c *gin.Context) { c.Status(204) })
	request := func(other bool) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/models", nil)
		if other {
			req.Header.Set("Test-User", "other")
		}
		r.ServeHTTP(w, req)
		return w
	}
	for i := 0; i < 120; i++ {
		if request(false).Code != 204 {
			t.Fatal("limited too early")
		}
	}
	blocked := request(false)
	if blocked.Code != 429 || blocked.Header().Get("Retry-After") != "2" || !strings.Contains(blocked.Body.String(), `"error"`) {
		t.Fatal("wrong protocol rate-limit response")
	}
	if request(true).Code != 204 {
		t.Fatal("one user's rate limit blocked another user sharing the proxy IP")
	}
}
