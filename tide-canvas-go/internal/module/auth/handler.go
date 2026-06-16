package auth

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 认证 HTTP 层。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册认证路由到给定父组（传入 /api 组 → 实际为 /api/auth/*）。
func (h *Handler) RegisterRoutes(api gin.IRouter) {
	g := api.Group("/auth")
	// 反刷流限流（对齐旧 @RateLimit 注解，均按 IP 维度）。
	g.POST("/email-code", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "email_code", Limit: 10, Period: 600 * time.Second, Dimension: middleware.DimIP, BanThreshold: 3, BanSeconds: 600,
	}), h.emailCode)
	g.POST("/register", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "register", Limit: 5, Period: 60 * time.Second, Dimension: middleware.DimIP, BanThreshold: 3, BanSeconds: 1800,
	}), h.register)
	g.POST("/login", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "login", Limit: 10, Period: 60 * time.Second, Dimension: middleware.DimIP, BanThreshold: 5, BanSeconds: 900,
	}), h.login)
	g.POST("/refresh", h.refresh)
	g.POST("/logout", h.logout)

	// 需登录
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(h.jwt))
	authed.GET("/me", h.me)
	authed.PUT("/password", h.updatePassword)
	authed.PUT("/profile", h.updateProfile)
}

func (h *Handler) emailCode(c *gin.Context) {
	var req SendEmailCodeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.SendEmailCode(req.Email); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) register(c *gin.Context) {
	var req RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Register(&req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) login(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Login(&req, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) refresh(c *gin.Context) {
	var req RefreshReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.RefreshToken(&req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) me(c *gin.Context) {
	vo, err := h.svc.CurrentUser(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) updatePassword(c *gin.Context) {
	var req UpdatePasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.UpdatePassword(middleware.MustUserID(c), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) updateProfile(c *gin.Context) {
	var req UpdateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.UpdateProfile(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) logout(c *gin.Context) {
	// 无状态 JWT：前端清除本地 token 即可。
	response.OK(c, nil)
}
