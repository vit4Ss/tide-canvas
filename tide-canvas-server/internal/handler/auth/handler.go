package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

// handler.go binds requests, invokes the service and writes the unified
// response envelope. Business errors are mapped to the frontend's ResultCode
// values (see tide-canvas-web/src/types/api.ts).

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// emailCode handles POST /api/auth/email-code. Throttling (per-IP cap and
// per-email cooldown) and SMTP failures surface as errors; otherwise it always
// reports generic success so the response never reveals whether the email is
// registered.
func (h *handler) emailCode(c *gin.Context) {
	var dto EmailCodeDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	email := strings.TrimSpace(strings.ToLower(dto.Email))
	if err := h.svc.emailCode(c.Request.Context(), email, c.ClientIP()); err != nil {
		switch {
		case errors.Is(err, errRateLimited):
			response.Fail(c, response.CodeRateLimited, "请求过于频繁，请稍后再试")
		case errors.Is(err, errSendFailed):
			response.Fail(c, response.CodeServerError, "邮件发送失败，请稍后重试")
		default:
			response.Fail(c, response.CodeServerError, "failed to send verification code")
		}
		return
	}
	response.OK[any](c, nil)
}

// register handles POST /api/auth/register.
func (h *handler) register(c *gin.Context) {
	var dto RegisterDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	vo, err := h.svc.register(c.Request.Context(), dto)
	if err != nil {
		logAuth(c, 0, dto.Email, "register", "code", err)
		switch {
		case errors.Is(err, errUsernameExists):
			response.Fail(c, response.CodeUsernameExists, "username already exists")
		case errors.Is(err, errEmailExists):
			response.Fail(c, response.CodeEmailExists, "email already registered")
		case errors.Is(err, errBadCode):
			response.Fail(c, response.CodeBadRequest, "invalid or expired verification code")
		default:
			response.Fail(c, response.CodeServerError, "registration failed")
		}
		return
	}
	logAuth(c, vo.ID, dto.Email, "register", "code", nil)
	response.OK(c, vo)
}

// login handles POST /api/auth/login.
func (h *handler) login(c *gin.Context) {
	var dto LoginDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	vo, err := h.svc.login(c.Request.Context(), dto)
	if err != nil {
		logAuth(c, 0, dto.Account, "login", "password", err)
		switch {
		case errors.Is(err, errBadCredentials):
			response.Fail(c, response.CodePasswordIncorrect, "incorrect account or password")
		case errors.Is(err, errAccountDisabled):
			response.Fail(c, response.CodeForbidden, "account disabled")
		default:
			response.Fail(c, response.CodeServerError, "login failed")
		}
		return
	}
	logAuth(c, vo.UserInfo.ID, dto.Account, "login", "password", nil)
	response.OK(c, vo)
}

// loginCode handles POST /api/auth/login-code. Passwordless login-or-create via
// an email verification code; returns the same LoginVO shape as /login.
func (h *handler) loginCode(c *gin.Context) {
	var dto LoginCodeDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	vo, err := h.svc.loginCode(c.Request.Context(), dto)
	if err != nil {
		logAuth(c, 0, dto.Email, "login_code", "code", err)
		switch {
		case errors.Is(err, errBadCode):
			response.Fail(c, response.CodePasswordIncorrect, "验证码错误或已过期")
		case errors.Is(err, errAccountDisabled):
			response.Fail(c, response.CodeForbidden, "account disabled")
		default:
			response.Fail(c, response.CodeServerError, "login failed")
		}
		return
	}
	logAuth(c, vo.UserInfo.ID, dto.Email, "login_code", "code", nil)
	response.OK(c, vo)
}

// refresh handles POST /api/auth/refresh. A failed refresh returns body code
// 401 so the frontend clears credentials and redirects to login.
func (h *handler) refresh(c *gin.Context) {
	var dto RefreshDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	vo, err := h.svc.refresh(dto.RefreshToken)
	if err != nil {
		response.Fail(c, response.CodeUnauthorized, "invalid or expired refresh token")
		return
	}
	response.OK(c, vo)
}

// logout handles POST /api/auth/logout (auth required).
func (h *handler) logout(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	jtiStr := c.GetString(middleware.CtxJTI)

	// Blacklist the access token for its remaining lifetime when known.
	ttl := remainingAccessTTL(c)
	if err := h.svc.logout(uid, jtiStr, ttl); err != nil {
		logAuth(c, uid, "", "logout", "", err)
		response.Fail(c, response.CodeServerError, "logout failed")
		return
	}
	logAuth(c, uid, "", "logout", "", nil)
	response.OK[any](c, nil)
}

// me handles GET /api/auth/me (auth required).
func (h *handler) me(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.me(uid)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Fail(c, response.CodeNotFound, "user not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load user")
		return
	}
	response.OK(c, vo)
}

// updatePassword handles PUT /api/auth/password (auth required).
func (h *handler) updatePassword(c *gin.Context) {
	var dto UpdatePasswordDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	uid := middleware.CurrentUserID(c)
	if err := h.svc.updatePassword(uid, dto); err != nil {
		logAuth(c, uid, "", "password_change", "", err)
		switch {
		case errors.Is(err, errPasswordWrong):
			response.Fail(c, response.CodePasswordIncorrect, "incorrect current password")
		case errors.Is(err, ErrNotFound):
			response.Fail(c, response.CodeNotFound, "user not found")
		default:
			response.Fail(c, response.CodeServerError, "failed to update password")
		}
		return
	}
	logAuth(c, uid, "", "password_change", "", nil)
	response.OK[any](c, nil)
}

// updateProfile handles PUT /api/auth/profile (auth required).
func (h *handler) updateProfile(c *gin.Context) {
	var dto UpdateProfileDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.updateProfile(uid, dto)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Fail(c, response.CodeNotFound, "user not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to update profile")
		return
	}
	response.OK(c, vo)
}

// remainingAccessTTL re-parses the bearer access token to determine its
// remaining lifetime so the blacklist entry self-cleans at expiry. On any error
// the token package falls back to a short default TTL.
func remainingAccessTTL(c *gin.Context) time.Duration {
	authz := c.GetHeader("Authorization")
	if !strings.HasPrefix(authz, "Bearer ") {
		return 0
	}
	raw := strings.TrimSpace(strings.TrimPrefix(authz, "Bearer "))
	claims, err := token.ParseAccess(raw)
	if err != nil {
		return 0
	}
	return claims.RemainingTTL()
}
