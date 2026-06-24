// Package market owns the model-marketplace routes (/api/market/*) plus their
// handler/service/repo/dto/vo. It mirrors the project domain's layout
// (register/handler/service/repo/dto/vo) and conventions.
package market

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the market routes on the /api group.
//
// Frontend contract (tide-canvas-web marketApi):
//
//	GET  /api/market/categories          -> []ModelCategoryVO                     (public)
//	GET  /api/market/models              MarketModelQuery -> PageData<MarketModelVO> (public)
//	GET  /api/market/models/:id          -> MarketModelVO                          (public)
//	POST /api/market/models/:id/like     -> void   (toggle like)                   (auth)
//	POST /api/market/models/:id/use      -> void   (record use)                    (auth)
//
// Route layout keeps gin free of static/param sibling conflicts: the only param
// segment (:id) lives under the static parent /models, and /categories is a
// sibling static segment. The like/use routes are static children of :id.
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB)
	h := newHandler(svc)

	g := api.Group("/market")

	// Public catalog reads — the marketplace is a public product surface.
	g.GET("/categories", h.categories)
	g.GET("/studio-models", h.studioModels)
	g.GET("/models", h.list)
	g.GET("/models/:id", h.get)

	// Authenticated interactions (like / record-use).
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.POST("/models/:id/like", h.like)
	authed.POST("/models/:id/use", h.use)
}
