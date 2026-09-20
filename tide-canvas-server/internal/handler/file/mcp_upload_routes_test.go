package file

import (
	"testing"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/app"
)

func TestRegisterMCPAssetRoutesDoNotConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("file route registration panicked: %v", recovered)
		}
	}()
	Register(gin.New().Group("/api"), &app.Deps{})
}
