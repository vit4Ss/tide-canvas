// Package admin wires the admin-console route surface under /api/admin. Every
// group is gated by JWTAuth + AdminOnly (role 9) so only administrators reach
// the dashboard, user/content/work moderation, AI provider/model/floor
// management, pricing/payments/points, marketing, resources, logs, config, and
// email endpoints.
package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts every admin sub-domain under /api/admin behind the
// JWTAuth + AdminOnly middleware chain.
func Register(api *gin.RouterGroup, d *app.Deps) {
	g := api.Group("/admin")
	g.Use(middleware.JWTAuth(d), middleware.AdminOnly())

	RegisterDashboard(g, d)
	RegisterUsers(g, d)
	RegisterWorks(g, d)
	RegisterInspiration(g, d)
	RegisterDiscover(g, d)
	RegisterModels(g, d)
	RegisterFloors(g, d)
	RegisterPricing(g, d)
	RegisterPayments(g, d)
	RegisterPoints(g, d)
	RegisterMarketing(g, d)
	RegisterResources(g, d)
	RegisterLogs(g, d)
	RegisterAuditLogs(g, d)
	RegisterConfig(g, d)
	RegisterEmail(g, d)
}
