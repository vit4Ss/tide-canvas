// Package project owns project & canvas routes (/api/projects/*) plus their
// handler/service/repo/dto/vo.
package project

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the project routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> projectApi):
//
//	GET    /api/projects                ProjectQuery -> PageData<ProjectVO>   (auth)
//	POST   /api/projects                ProjectCreateDTO -> ProjectVO         (auth)
//	GET    /api/projects/:id            -> ProjectDetailVO                    (auth)
//	GET    /api/shared/:token           -> ProjectDetailVO   (public share)
//	PUT    /api/projects/:id            ProjectUpdateDTO -> ProjectVO         (auth)
//	DELETE /api/projects/:id            -> void                               (auth)
//	PUT    /api/projects/:id/canvas     CanvasSaveDTO -> void                 (auth)
//	GET    /api/projects/:id/canvas     -> CanvasDataVO                       (auth)
//	POST   /api/projects/:id/share      -> ShareVO                            (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.Cfg)
	h := newHandler(svc)

	// Public share-by-token lookup (no auth). Mounted on the parent /api group
	// as /api/shared/:token so the :token segment is never a sibling of the
	// /projects/:id param segment (gin panics on static/param siblings).
	api.GET("/shared/:token", h.getByToken)

	g := api.Group("/projects")

	// Authenticated routes.
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.GET("", h.list)
	authed.POST("", h.create)
	authed.GET("/:id", h.get)
	authed.PUT("/:id", h.update)
	authed.DELETE("/:id", h.remove)
	authed.PUT("/:id/canvas", h.saveCanvas)
	authed.GET("/:id/canvas", h.getCanvas)
	authed.POST("/:id/share", h.share)
}
