package oauth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestValidateOAuthStateRequiresMatchingProviderCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := httptest.NewRequest(http.MethodPost, "/api/auth/oauth/github", nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: "github|state123"})
	ctx.Request = req

	if !validateOAuthState(ctx, ProviderGitHub, "state123") {
		t.Fatal("expected matching provider and state to validate")
	}
	if validateOAuthState(ctx, ProviderGoogle, "state123") {
		t.Fatal("expected provider mismatch to fail")
	}
	if validateOAuthState(ctx, ProviderGitHub, "other") {
		t.Fatal("expected state mismatch to fail")
	}
}
