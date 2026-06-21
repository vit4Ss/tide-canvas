// Package billing owns pricing (定价 plans + point packages) and order
// (订单) routes (/api/billing/* and /api/orders/*) plus their
// handler/service/repo/dto/vo.
package billing

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the billing & order routes on the /api group.
//
// Frontend contract (tide-canvas-web -> billingApi / orderApi):
//
//	GET    /api/billing/plans      -> []PlanVO                         (public)
//	GET    /api/billing/packages   -> []PointPackageVO                 (public)
//	POST   /api/billing/notify     -> "success" (text)                 (public webhook)
//	POST   /api/orders             CreateOrderDTO -> OrderVO           (auth)
//	GET    /api/orders             OrderQuery -> PageData<OrderVO>     (auth)
//	GET    /api/orders/:id         -> OrderVO                          (auth)
//	POST   /api/orders/:id/cancel  -> void                             (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.Cfg)
	h := newHandler(svc)

	// Public pricing catalog + payment-gateway webhook. All three are static
	// siblings under /billing (no param segments) so gin never panics on a
	// static-vs-param conflict.
	b := api.Group("/billing")
	b.GET("/plans", h.listPlans)
	b.GET("/packages", h.listPackages)
	b.POST("/notify", h.notify)

	// Authenticated orders. The :id param sits only under the static /orders
	// parent, with no static sibling at the same position.
	o := api.Group("/orders")
	o.Use(middleware.JWTAuth(d))
	o.POST("", h.createOrder)
	o.GET("", h.listOrders)
	o.GET("/:id", h.getOrder)
	o.POST("/:id/cancel", h.cancelOrder)
}
