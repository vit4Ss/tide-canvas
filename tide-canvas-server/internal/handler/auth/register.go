// Package auth owns authentication & account routes (/api/auth/*) plus their
// handler/service/repo/dto/vo.
package auth

import (
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
)

// Register mounts the auth routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> authApi):
//
//	GET  /api/auth/register-config                      -> {registerClosed}
//	POST /api/auth/email-code   {email}                 -> void
//	POST /api/auth/register     UserRegisterDTO         -> UserVO
//	POST /api/auth/login        UserLoginDTO            -> LoginVO
//	POST /api/auth/login-code   {email,code}            -> LoginVO  (passwordless login-or-create)
//	POST /api/auth/refresh      {refreshToken}          -> {accessToken,refreshToken,expiresIn}
//	POST /api/auth/reset-password ResetPasswordDTO      -> void   (public, passwordless via email code)
//	POST /api/auth/logout                               -> void   (auth)
//	GET  /api/auth/me                                   -> UserVO (auth)
//	PUT  /api/auth/password     UpdatePasswordDTO       -> void   (auth)
//	PUT  /api/auth/profile      UpdateProfileDTO        -> UserVO (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.RDB, d.Cfg.Email)
	h := newHandler(svc)

	g := api.Group("/auth")

	// Public routes.
	// 注册开关(后台配置管理 auth.registerClosed):登录页据此隐藏/禁用注册入口。
	// 服务端三个建号路径(register/register-local/login-code 首次建号)各自硬拦,
	// 这里只是给前端的展示信号。
	g.GET("/register-config", func(c *gin.Context) {
		response.OK(c, gin.H{"registerClosed": svc.registerClosed()})
	})
	g.POST("/email-code", h.emailCode)
	g.POST("/register", h.register)
	// 用户名+密码本地注册(免邮箱,注册即登录)。没有验证码摩擦,批量灌号/薅新手
	// 积分只能靠 IP 限速兜底,窗口比登录更紧。
	g.POST("/register-local", middleware.RateLimit(d, 5, 10*time.Minute), h.registerLocal)
	// Throttle password / code login per-IP to blunt credential brute-force
	// (findByAccount matches username OR email OR phone, so a known account can
	// otherwise be sprayed unbounded — only bcrypt's cost slows it).
	g.POST("/login", middleware.RateLimit(d, 10, 5*time.Minute), h.login)
	g.POST("/login-code", middleware.RateLimit(d, 10, 5*time.Minute), h.loginCode)
	g.POST("/refresh", h.refresh)
	// Rate-limit the unauthenticated password reset to blunt distributed
	// code brute-force (the per-email attempt cap already bounds a single code).
	g.POST("/reset-password", middleware.RateLimit(d, 10, 10*time.Minute), h.resetPassword)

	// Authenticated routes.
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.POST("/logout", h.logout)
	authed.GET("/me", h.me)
	authed.PUT("/password", h.updatePassword)
	authed.PUT("/profile", h.updateProfile)
}
