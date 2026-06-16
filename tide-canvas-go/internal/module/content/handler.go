package content

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 内容审核 HTTP 层（路由薄层），统一挂载于 /api/admin/contents。
type Handler struct {
	svc *Service
}

// NewHandler 构造（传入共享 *gorm.DB 与 logger，内部装配 repo/service）。logger 可为 nil。
func NewHandler(db *gorm.DB, logger *logrus.Logger) *Handler {
	return &Handler{svc: NewService(NewRepository(db), logger)}
}

// RegisterRoutes 注册内容审核路由（传入 /api 组 → 实际 /api/admin/contents）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）。
// 权限码忠实迁移旧 AdminContentController：列表 content:view，审核 content:audit。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	contents := api.Group("/admin/contents")
	contents.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	contents.GET("", middleware.RequiresPermission(permLoader, "content:view"), h.list)
	contents.PUT("/:id", middleware.RequiresPermission(permLoader, "content:audit"), h.audit)
}

// list GET /api/admin/contents 公开作品分页（权限码 content:view）。
func (h *Handler) list(c *gin.Context) {
	var q ContentQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.List(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// audit PUT /api/admin/contents/:id 审核改状态（:id 为 public_id，权限码 content:audit）。
func (h *Handler) audit(c *gin.Context) {
	var req AuditReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.Audit(c.Param("id"), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
