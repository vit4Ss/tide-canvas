// Package admin wires the admin-console route surface under /api/admin. Every
// group is gated by JWTAuth + AdminAccess(role 9 超管或角色持有 admin.* 模块
// 权限),每个子域再按 AdminPerm(admin.<模块>) 细分,so only被授权者 reach
// the dashboard, user/content/work moderation, AI provider/model/floor/tool
// management, pricing/payments/points, logs, config, and email endpoints.
// （营销管理已于 2026-07-10 整链下线,资源管理已于 2026-07-09 整链下线。）
package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts every admin sub-domain under /api/admin behind the
// JWTAuth + AdminAccess middleware chain,并按后台模块细分权限:
// role=9 超管全量;运营角色按 sys_role.permissions 里的 admin.<模块> 键放行
// (键表见 model.AdminModuleKeys,与前端后台侧栏一一对应)。
func Register(api *gin.RouterGroup, d *app.Deps) {
	g := api.Group("/admin")
	g.Use(middleware.JWTAuth(d), middleware.AdminAccess(d))

	// mod 为一个后台模块建带权限键的子组(路径不变,仅追加 AdminPerm 判定)
	mod := func(key string) *gin.RouterGroup {
		return g.Group("", middleware.AdminPerm("admin."+key))
	}

	RegisterDashboard(mod("dashboard"), d)
	RegisterUsers(mod("users"), d)
	RegisterWorks(mod("works"), d)
	RegisterInspiration(mod("inspiration"), d)
	RegisterGenerations(mod("generations"), d)
	RegisterCoverSync(mod("works"), mod("inspiration"), d)
	RegisterStyles(mod("styles"), d)
	RegisterSkills(mod("skills"), d)
	RegisterBlog(mod("blog"), d)
	RegisterModels(mod("models"), d)
	RegisterFloors(mod("floors"), d)
	RegisterTools(mod("tools"), d)
	RegisterCanvasNodes(mod("canvas"), d)
	RegisterPricing(mod("pricing"), d)
	RegisterPayments(mod("payments"), d)
	RegisterSupplierBalances(mod("balances"), d)
	RegisterActivationCodes(mod("activation_codes"), d)
	RegisterPoints(mod("points"), d)
	RegisterLogs(mod("logs"), d)
	RegisterAuditLogs(mod("logs"), d)
	RegisterConfig(mod("config"), d)
	RegisterEmail(mod("email"), d)
	RegisterNotifications(mod("notifications"), d)
	RegisterAlerts(mod("alerts"), d)
}
