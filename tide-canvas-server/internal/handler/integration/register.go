// Package integration exposes owner-controlled default API keys and an
// identity probe for external applications. Model invocation is a separate
// gateway integration, not implicitly granted access to JWT-only routes.
package integration

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/userkey"
)

type keyVO struct {
	Name       string    `json:"name"`
	Hint       string    `json:"hint"`
	Enabled    bool      `json:"enabled"`
	Revision   uint64    `json:"revision"`
	CreateTime time.Time `json:"createTime"`
	UpdateTime time.Time `json:"updateTime"`
}

func view(row *model.UserAPIKey) keyVO {
	return keyVO{Name: "默认 API Key", Hint: row.Hint, Enabled: row.DisabledAt == nil, Revision: row.Revision, CreateTime: row.CreateTime, UpdateTime: row.UpdateTime}
}

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, userkey.ErrAccount):
		response.Fail(c, response.CodeForbidden, "账号不可用")
	case errors.Is(err, userkey.ErrConflict):
		response.Fail(c, 409, "密钥已在其他页面更新，请刷新后再操作")
	case errors.Is(err, userkey.ErrVault):
		response.Fail(c, response.CodeBadRequest, "密钥暂时无法读取，请联系管理员或重置密钥")
	default:
		response.Fail(c, response.CodeServerError, "密钥操作失败")
	}
}

func Register(api *gin.RouterGroup, d *app.Deps) {
	keys := d.UserKeys
	g := api.Group("/auth/api-key", middleware.JWTAuth(d), middleware.RateLimit(d, 30, time.Minute))
	g.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Pragma", "no-cache")
		// This is an account-change fence, never an account selector. A browser
		// retry using a newly logged-in session must not touch another user's key.
		if expected := c.Query("accountId"); expected != "" && expected != middleware.CurrentUserID(c).String() {
			response.Fail(c, 409, "登录账号已变化，请刷新页面后再操作")
			c.Abort()
			return
		}
		if keys == nil {
			response.Fail(c, response.CodeServerError, "密钥服务未配置")
			c.Abort()
			return
		}
		if _, err := keys.ActiveOwner(c.Request.Context(), middleware.CurrentUserID(c)); err != nil {
			fail(c, err)
			c.Abort()
			return
		}
		c.Next()
	})
	g.GET("", func(c *gin.Context) {
		row, err := keys.Ensure(c.Request.Context(), middleware.CurrentUserID(c))
		if err != nil {
			fail(c, err)
			return
		}
		response.OK(c, view(row))
	})
	type revisionDTO struct {
		Revision uint64 `json:"revision" binding:"required,min=1"`
	}
	g.POST("/reveal", func(c *gin.Context) {
		var dto revisionDTO
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "请刷新密钥后再查看")
			return
		}
		uid := middleware.CurrentUserID(c)
		value, err := keys.Reveal(c.Request.Context(), uid, dto.Revision)
		if err != nil {
			fail(c, err)
			return
		}
		eventlog.Biz(&model.BizLog{UserID: uid, Action: "api_key.reveal", Summary: "查看默认 API Key"})
		response.OK(c, gin.H{"key": value, "revision": dto.Revision})
	})
	g.POST("/rotate", func(c *gin.Context) {
		var dto revisionDTO
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "请刷新密钥后再重置")
			return
		}
		uid := middleware.CurrentUserID(c)
		row, err := keys.Change(c.Request.Context(), uid, dto.Revision, true, false)
		if err != nil {
			fail(c, err)
			return
		}
		eventlog.Biz(&model.BizLog{UserID: uid, Action: "api_key.rotate", Summary: "重置默认 API Key"})
		response.OK(c, view(row))
	})
	g.PUT("/status", func(c *gin.Context) {
		var dto struct {
			Revision uint64 `json:"revision" binding:"required,min=1"`
			Enabled  *bool  `json:"enabled" binding:"required"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "请提供密钥状态和版本")
			return
		}
		uid := middleware.CurrentUserID(c)
		row, err := keys.Change(c.Request.Context(), uid, dto.Revision, false, *dto.Enabled)
		if err != nil {
			fail(c, err)
			return
		}
		summary := "停用默认 API Key"
		if *dto.Enabled {
			summary = "启用默认 API Key"
		}
		eventlog.Biz(&model.BizLog{UserID: uid, Action: "api_key.status", Summary: summary})
		response.OK(c, view(row))
	})

	api.GET("/integrations/identity", middleware.UserAPIKeyAuth(keys), middleware.RateLimit(d, 60, time.Minute), func(c *gin.Context) {
		owner := c.MustGet("integration.owner").(*model.User)
		// A minimal identity/connection check. Do not expose login credentials,
		// email, admin permissions or upstream API keys to integration clients.
		c.JSON(http.StatusOK, gin.H{"userId": owner.ID, "points": owner.Points})
	})
}
