// Package auth owns authentication & account routes (/api/auth/*) plus their
// handler/service/repo/dto/vo.
package auth

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the auth routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> authApi):
//
//	POST /api/auth/email-code   {email}                 -> void
//	POST /api/auth/register     UserRegisterDTO         -> UserVO
//	POST /api/auth/login        UserLoginDTO            -> LoginVO
//	POST /api/auth/login-code   {email,code}            -> LoginVO  (passwordless login-or-create)
//	POST /api/auth/refresh      {refreshToken}          -> {accessToken,refreshToken,expiresIn}
//	POST /api/auth/logout                               -> void   (auth)
//	GET  /api/auth/me                                   -> UserVO (auth)
//	PUT  /api/auth/password     UpdatePasswordDTO       -> void   (auth)
//	PUT  /api/auth/profile      UpdateProfileDTO        -> UserVO (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.RDB, d.Cfg.Email)
	h := newHandler(svc)

	g := api.Group("/auth")

	// Public routes.
	g.POST("/email-code", h.emailCode)
	g.POST("/register", h.register)
	g.POST("/login", h.login)
	g.POST("/login-code", h.loginCode)
	g.POST("/refresh", h.refresh)

	// Authenticated routes.
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.POST("/logout", h.logout)
	authed.GET("/me", h.me)
	authed.PUT("/password", h.updatePassword)
	authed.PUT("/profile", h.updateProfile)
}
