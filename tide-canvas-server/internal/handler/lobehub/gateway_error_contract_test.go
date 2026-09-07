package lobehub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInsufficientPointsUsesLobeHubRecognizedOpenAIError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	gatewayInsufficientPoints(c)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
	var body struct {
		Error struct {
			Type    string `json:"type"`
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(w.Body.Bytes(), &body) != nil {
		t.Fatalf("invalid error response: %s", w.Body.String())
	}
	if body.Error.Type != "insufficient_quota" || body.Error.Code != "insufficient_quota" || !strings.Contains(body.Error.Message, "积分不足") {
		t.Fatalf("unrecognized quota error: %#v", body.Error)
	}
}

func TestBareUpstreamErrorBecomesAnActionableHTTPFailure(t *testing.T) {
	got := upstreamErrorMessage(strings.NewReader(`{"type":500,"message":"Error"}`), http.StatusInternalServerError)
	if got != "模型服务返回 HTTP 500" {
		t.Fatalf("generic upstream error = %q", got)
	}
}
