package style

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 负责风格库用户端和管理端 HTTP 接口。
type Handler struct {
	svc *Service
}

// NewHandler 创建风格库 Handler。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册风格库路由。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	user := api.Group("/styles")
	user.Use(middleware.JWTAuth(jwtProvider))
	user.GET("", h.listUserPresets)
	user.POST("", h.createCustomPreset)
	user.POST("/:id/favorite", h.toggleFavorite)
	user.POST("/:id/use", h.recordUse)

	admin := api.Group("/admin/styles")
	admin.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	admin.GET("", middleware.RequiresPermission(permLoader, "style:view"), h.listAdminPresets)
	admin.POST("", middleware.RequiresPermission(permLoader, "style:manage"), h.createAdminPreset)
	admin.PUT("/:id", middleware.RequiresPermission(permLoader, "style:manage"), h.updateAdminPreset)
	admin.DELETE("/:id", middleware.RequiresPermission(permLoader, "style:manage"), h.deleteAdminPreset)
}

func (h *Handler) listUserPresets(c *gin.Context) {
	var q PresetQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListUserPresets(middleware.MustUserID(c), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

func (h *Handler) createCustomPreset(c *gin.Context) {
	var dto PresetSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateCustom(middleware.MustUserID(c), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) toggleFavorite(c *gin.Context) {
	favorited, err := h.svc.ToggleFavorite(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, ToggleFavoriteVO{Favorited: favorited})
}

func (h *Handler) recordUse(c *gin.Context) {
	if err := h.svc.RecordUse(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) listAdminPresets(c *gin.Context) {
	var q PresetQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListAdminPresets(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

func (h *Handler) createAdminPreset(c *gin.Context) {
	var dto PresetSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateAdmin(&dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) updateAdminPreset(c *gin.Context) {
	var dto PresetSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.UpdateAdmin(c.Param("id"), &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) deleteAdminPreset(c *gin.Context) {
	if err := h.svc.DeleteAdmin(c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
