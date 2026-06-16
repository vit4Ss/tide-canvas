package banner

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler Banner HTTP 层。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册 Banner 路由到 /api 组：
//   - 公开：GET /api/banners（首页轮播，仅启用中的）
//   - 管理端：/api/admin/banners CRUD（需登录 + 管理员）
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	if jwtProvider != nil {
		h.jwt = jwtProvider
	}

	// 公开列表
	api.GET("/banners", h.publicList)

	// 管理端 CRUD
	admin := api.Group("/admin/banners")
	admin.Use(middleware.JWTAuth(h.jwt), middleware.AdminOnly())
	admin.GET("", h.adminList)
	admin.POST("", h.create)
	admin.PUT("/:id", h.update)
	admin.DELETE("/:id", h.delete)
}

// publicList 启用中的 Banner 列表（首页轮播）。
func (h *Handler) publicList(c *gin.Context) {
	list, err := h.svc.ListEnabled()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, list)
}

// adminList 全部 Banner 列表（管理端）。
func (h *Handler) adminList(c *gin.Context) {
	list, err := h.svc.ListAll()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, list)
}

func (h *Handler) create(c *gin.Context) {
	var req CreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Create(&req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) update(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var req UpdateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.Update(id, &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) delete(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// parseID 解析路径参数 id（雪花主键，int64）；非法则写出 400 并返回 false。
func parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		response.Fail(c, ecode.BadRequest)
		return 0, false
	}
	return id, true
}
