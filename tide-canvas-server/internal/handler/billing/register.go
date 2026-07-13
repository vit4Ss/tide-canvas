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
//	GET    /api/billing/plans        -> []PlanVO                       (public)
//	GET    /api/billing/channels     -> []PayChannelVO                 (public)
//	GET/POST /api/billing/notify     -> "success"|"fail" (text)        (epay webhook)
//	POST   /api/orders               CreateOrderDTO{cycle} -> OrderVO{payUrl} (auth)
//	GET    /api/orders               OrderQuery -> PageData<OrderVO>   (auth)
//	GET    /api/orders/:id           -> OrderVO{payUrl if pending}     (auth)
//	POST   /api/orders/:id/cancel    -> void                           (auth)
//	POST   /api/orders/:id/verify    -> VerifyResult{paid,granted}     (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.Cfg)
	h := newHandler(svc)

	// Public pricing catalog + payment-gateway webhook. All routes are static
	// siblings under /billing (no param segments) so gin never panics on a
	// static-vs-param conflict. 积分包的用户端购买/读取已下线（积分只随套餐
	// 发放）；管理端 /api/admin/packages 不受影响。
	b := api.Group("/billing")
	b.GET("/plans", h.listPlans)
	// 定价页方案对比表（行内容；列=真实套餐，由客户端拼装）。
	b.GET("/compare", h.getCompare)
	// 定价页常见问题 FAQ（后台价格管理可编辑）。
	b.GET("/faq", h.getFaq)
	// 定价页限时折扣横幅（后台价格管理可编辑；关闭或到期前端隐藏）。
	b.GET("/promo", h.getPromo)
	// 可用支付方式由管理后台「支付渠道」开关驱动（pay_channel.enabled）。
	b.GET("/channels", h.listChannels)
	// epay delivers the async notify as a GET (query params); accept POST too.
	b.GET("/notify", h.notify)
	b.POST("/notify", h.notify)

	// Authenticated orders. The :id param sits only under the static /orders
	// parent, with no static sibling at the same position.
	o := api.Group("/orders")
	o.Use(middleware.JWTAuth(d))
	o.POST("", h.createOrder)
	o.GET("", h.listOrders)
	o.GET("/:id", h.getOrder)
	o.POST("/:id/cancel", h.cancelOrder)
	// return_url backstop: credit a paid order if the async notify was dropped.
	o.POST("/:id/verify", h.verify)
}
