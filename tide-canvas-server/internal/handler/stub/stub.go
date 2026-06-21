// Package stub provides placeholder/liveness routes (/api/ping, /api/version).
//
// The extended domains (community, blog, points, orders/billing, market, im,
// notifications, banners, home) are owned by their real handler packages and
// registered from cmd/api/main.go. The admin console is likewise owned by the
// admin handler package (internal/handler/admin) and registered from main.go,
// so stub no longer mounts it (mounting it here would panic gin with duplicate
// routes).
//
// The engine-wide NoRoute fallback (for unmatched paths) is configured in
// cmd/api/main.go, where the *gin.Engine is in scope.
package stub

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/pkg/response"
)

// Register wires the liveness routes on the /api group.
func Register(api *gin.RouterGroup, d *app.Deps) {
	// Liveness ping exercising the standard success envelope.
	api.GET("/ping", func(c *gin.Context) {
		response.OK(c, gin.H{"pong": true})
	})

	// Version/info placeholder.
	api.GET("/version", func(c *gin.Context) {
		response.OK(c, gin.H{"name": "tide-canvas-server", "version": "0.1.0"})
	})
}
