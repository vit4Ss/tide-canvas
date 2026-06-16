package setting

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 系统设置 HTTP 层（路由薄层），统一挂载于 /api/admin/settings。
type Handler struct {
	svc *Service
}

// NewHandler 构造（传入共享 *gorm.DB，内部装配 repo/service）。
func NewHandler(db *gorm.DB) *Handler {
	return &Handler{svc: NewService(NewRepository(db))}
}

// RegisterRoutes 注册系统设置路由（传入 /api 组 → 实际 /api/admin/settings）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）。
// 权限码忠实迁移旧 AdminSettingController：读取 setting:view，保存 setting:edit。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	settings := api.Group("/admin/settings")
	settings.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	settings.GET("", middleware.RequiresPermission(permLoader, "setting:view"), h.get)
	settings.PUT("", middleware.RequiresPermission(permLoader, "setting:edit"), h.update)
}

// get GET /api/admin/settings 读取全部系统配置（权限码 setting:view）。
func (h *Handler) get(c *gin.Context) {
	data, err := h.svc.Get()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, data)
}

// update PUT /api/admin/settings 批量保存配置（权限码 setting:edit）。
// 请求体为 key→value 对象（前端只提交有变更的项）。
func (h *Handler) update(c *gin.Context) {
	var settings map[string]interface{}
	if err := c.ShouldBindJSON(&settings); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.Save(settings); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
