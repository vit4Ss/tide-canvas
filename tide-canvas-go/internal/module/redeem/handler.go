package redeem

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 兑换码 HTTP 层（对齐 RedeemController + AdminRedeemController）。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册兑换码路由到给定父组（传入 /api 组）。
//
//   - 用户端 /api/redeem（需登录）
//   - 管理端 /api/admin/redeem/*（需登录 + 管理员）
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	// 用户兑换：POST /api/redeem（对齐 RedeemController @RequestMapping("/api/redeem")）。
	redeem := api.Group("/redeem")
	redeem.Use(middleware.JWTAuth(jwtProvider))
	redeem.POST("", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "redeem", Limit: 10, Period: 60 * time.Second, Dimension: middleware.DimIP, BanThreshold: 5, BanSeconds: 900,
	}), h.redeem)

	// 管理端：/api/admin/redeem/*（对齐 AdminRedeemController @RequestMapping("/api/admin/redeem")）。
	admin := api.Group("/admin/redeem")
	admin.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	admin.POST("/generate", h.generate)
	admin.GET("", h.list)
	admin.PUT("/:id/status", h.updateStatus)
	admin.DELETE("/:id", h.delete)
}

// redeem POST /api/redeem 用户兑换。
func (h *Handler) redeem(c *gin.Context) {
	var req RedeemReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Redeem(middleware.MustUserID(c), req.Code)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// generate POST /api/admin/redeem/generate 批量生成兑换码，返回码列表。
func (h *Handler) generate(c *gin.Context) {
	var req GenerateRedeemReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	creatorID := middleware.MustUserID(c)
	codes, err := h.svc.Generate(&creatorID, &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, codes)
}

// list GET /api/admin/redeem 兑换码分页列表。
func (h *Handler) list(c *gin.Context) {
	var q RedeemCodeQuery
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

// updateStatus PUT /api/admin/redeem/:id/status 启用/停用。
func (h *Handler) updateStatus(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	var req UpdateStatusReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Status == nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.UpdateStatus(id, *req.Status); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// delete DELETE /api/admin/redeem/:id 删除兑换码。
func (h *Handler) delete(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.Delete(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// parseInt64Param 解析 int64 路径参数（管理端按主键操作）。
func parseInt64Param(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
