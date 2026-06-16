package admin

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// Handler 后台管理 HTTP 层（聚合各子域 service，统一挂载于 /api/admin/*）。
//
// 全部接口：JWTAuth + AdminOnly + RequiresPermission(按钮级权限码)（权限码见各路由注册处）。
//
// 子域：
//   - 用户管理     user_admin.go       /api/admin/users
//   - 角色权限     role_admin.go       /api/admin/roles
//   - 作者审核     author_admin.go     /api/admin/authors
//   - 邮件模板     email_template_admin.go  /api/admin/email-templates
//   - 积分管理     points_admin.go     /api/admin/points
//   - 数据面板     overview.go         /api/admin/dashboard
type Handler struct {
	jwt *appjwt.Provider

	userSvc     *UserAdminService
	roleSvc     *RoleAdminService
	authorSvc   *AuthorAdminService
	emailSvc    *EmailTemplateAdminService
	pointsSvc   *PointsAdminService
	overviewSvc *OverviewService
}

// NewHandler 构造后台管理 Handler。
//
// 依赖装配：
//   - repo        本模块 Repository（admin.NewRepository(db)）。
//   - pointsSvc   注入 points.Service（积分调整/退款/流水分页能力）。
//   - mailSender  注入测试邮件发送器；未配置 SMTP 时传 admin.NoopMailSender{Logger: logger}。
//   - logger      可为 nil。
func NewHandler(
	repo *Repository,
	pointsSvc PointsService,
	mailSender MailSender,
	jwtProvider *appjwt.Provider,
	logger *logrus.Logger,
) *Handler {
	return &Handler{
		jwt:         jwtProvider,
		userSvc:     NewUserAdminService(repo),
		roleSvc:     NewRoleAdminService(repo),
		authorSvc:   NewAuthorAdminService(repo),
		emailSvc:    NewEmailTemplateAdminService(repo, mailSender, logger),
		pointsSvc:   NewPointsAdminService(repo, pointsSvc),
		overviewSvc: NewOverviewService(repo, logger),
	}
}

// RegisterRoutes 注册全部后台路由到给定父组（传入 /api 组 → 实际 /api/admin/*）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）。
// 各接口的权限码忠实迁移旧后端各 AdminXxxController 上的 @RequiresPermission（见 AdminPermissions 目录）。
// permLoader 由 router 注入一次后在全部路由复用（middleware.NewDBPermissionLoader(db)）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	admin := api.Group("/admin")
	admin.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())

	// 用户管理 /api/admin/users
	users := admin.Group("/users")
	users.GET("", middleware.RequiresPermission(permLoader, "user:view"), h.listUsers)
	users.GET("/:id", middleware.RequiresPermission(permLoader, "user:view"), h.getUser)
	users.PUT("/:id", middleware.RequiresPermission(permLoader, "user:edit"), h.updateUser)

	// 角色权限 /api/admin/roles
	roles := admin.Group("/roles")
	roles.GET("", middleware.RequiresPermission(permLoader, "role:view"), h.listRoles)
	roles.GET("/catalog", middleware.RequiresPermission(permLoader, "role:view"), h.permissionCatalog)
	// my-permissions 仅返回当前管理员自身权限码（前端据此隐藏菜单/按钮），旧版无 @RequiresPermission，不鉴权。
	roles.GET("/my-permissions", h.myPermissions)
	roles.POST("", middleware.RequiresPermission(permLoader, "role:manage"), h.createRole)
	roles.PUT("/:id", middleware.RequiresPermission(permLoader, "role:manage"), h.updateRole)
	roles.DELETE("/:id", middleware.RequiresPermission(permLoader, "role:manage"), h.deleteRole)

	// 作者审核 /api/admin/authors
	authors := admin.Group("/authors")
	authors.GET("", middleware.RequiresPermission(permLoader, "author:view"), h.listAuthors)
	authors.POST("/:id/grant", middleware.RequiresPermission(permLoader, "author:manage"), h.grantAuthor)
	authors.POST("/:id/revoke", middleware.RequiresPermission(permLoader, "author:manage"), h.revokeAuthor)

	// 邮件模板 /api/admin/email-templates
	emails := admin.Group("/email-templates")
	emails.GET("", middleware.RequiresPermission(permLoader, "email:view"), h.listTemplates)
	emails.GET("/:id", middleware.RequiresPermission(permLoader, "email:view"), h.getTemplate)
	emails.PUT("/:id", middleware.RequiresPermission(permLoader, "email:edit"), h.updateTemplate)
	emails.POST("/preview", middleware.RequiresPermission(permLoader, "email:view"), h.previewTemplate)
	emails.POST("/:id/send-test", middleware.RequiresPermission(permLoader, "email:edit"), h.sendTestTemplate)

	// 积分管理 /api/admin/points
	pointsGroup := admin.Group("/points")
	pointsGroup.GET("/transactions", middleware.RequiresPermission(permLoader, "points:view"), h.listTransactions)
	pointsGroup.POST("/adjust", middleware.RequiresPermission(permLoader, "points:adjust"), h.adjustPoints)
	pointsGroup.POST("/refund-task", middleware.RequiresPermission(permLoader, "points:refund"), h.refundTask)

	// 数据面板 /api/admin/dashboard
	dashboard := admin.Group("/dashboard")
	dashboard.GET("/overview", middleware.RequiresPermission(permLoader, "dashboard:view"), h.overview)
	dashboard.GET("/charts", middleware.RequiresPermission(permLoader, "dashboard:view"), h.charts)
	dashboard.GET("/active-users", middleware.RequiresPermission(permLoader, "dashboard:view"), h.dashboardActiveUsers)
}
