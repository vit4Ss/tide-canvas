// Package admin wires the admin-console route surface under /api/admin. Every
// group is gated by JWTAuth + AdminOnly (role 9) so only administrators reach
// the dashboard, user/content/work moderation, AI provider/model/floor/tool
// management, pricing/payments/points, logs, config, and email endpoints.
//（营销管理已于 2026-07-10 整链下线,资源管理已于 2026-07-09 整链下线。）
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
	RegisterStyles(g, d)
	RegisterBlog(g, d)
	RegisterModels(g, d)
	RegisterFloors(g, d)
	RegisterTools(g, d)
	RegisterPricing(g, d)
	RegisterPayments(g, d)
	RegisterPoints(g, d)
	RegisterLogs(g, d)
	RegisterAuditLogs(g, d)
	RegisterConfig(g, d)
	RegisterEmail(g, d)
	RegisterNotifications(g, d)
}
