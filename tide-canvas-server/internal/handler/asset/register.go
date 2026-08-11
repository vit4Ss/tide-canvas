// Package asset owns the unified, user-facing media history API. Billing stays
// in ai_tasks and storage quota stays in files; media_assets is an interaction
// index that gives every concrete output a stable id.
package asset

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

func Register(api *gin.RouterGroup, deps *app.Deps) {
	h := newHandler(deps)
	g := api.Group("/media-assets")
	g.Use(middleware.JWTAuth(deps))
	g.GET("", h.list)
	g.DELETE("/:id", h.remove)
	g.POST("/batch-delete", h.batchDelete)
}
