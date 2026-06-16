package recharge

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 充值订单 + 支付 HTTP 层（对齐 OrderController + PaymentNotifyController，前缀 /api/orders）。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册订单与支付路由到给定父组（传入 /api 组 → 实际 /api/orders/*）。
//
// 公开（免登录，供易支付服务器回调）：
//
//	GET|POST /api/orders/notify/epay
//
// 其余全部需登录（对齐 SecurityUtils.getCurrentUserId）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	// 公开回调组（不挂 JWT 中间件）。
	pub := api.Group("/orders")
	pub.GET("/notify/epay", h.notify)
	pub.POST("/notify/epay", h.notify)

	// 需登录组。
	g := api.Group("/orders")
	g.Use(middleware.JWTAuth(jwtProvider))
	g.POST("/recharge", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "recharge_create", Limit: 10, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 5, BanSeconds: 600,
	}), h.createRecharge)
	g.GET("/recharge-config", h.rechargeConfig)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("/:id/pay", h.pay)
	g.POST("/:id/sync", h.sync)
	g.POST("/:id/cancel", h.cancel)
}

// createRecharge POST /api/orders/recharge 创建充值订单。
func (h *Handler) createRecharge(c *gin.Context) {
	var req RechargeCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateOrder(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// rechargeConfig GET /api/orders/recharge-config 充值配置（比例/支付方式/在线支付开关）。
func (h *Handler) rechargeConfig(c *gin.Context) {
	vo, err := h.svc.GetRechargeConfig()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// pay POST /api/orders/:id/pay 发起在线支付。
func (h *Handler) pay(c *gin.Context) {
	// 请求体可空（对齐 @RequestBody(required = false)）。
	var req PaymentInitiateReq
	_ = c.ShouldBindJSON(&req)
	vo, err := h.svc.InitiatePay(middleware.MustUserID(c), c.Param("id"), req.PayType)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// sync POST /api/orders/:id/sync 主动同步支付状态（支付完成未收到回调时）。
func (h *Handler) sync(c *gin.Context) {
	vo, err := h.svc.SyncOrderStatus(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// list GET /api/orders 订单列表。
func (h *Handler) list(c *gin.Context) {
	var q OrderQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListOrders(middleware.MustUserID(c), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// get GET /api/orders/:id 订单详情。
func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.GetUserOrder(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// cancel POST /api/orders/:id/cancel 取消订单。
func (h *Handler) cancel(c *gin.Context) {
	if err := h.svc.CancelOrder(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// notify GET|POST /api/orders/notify/epay 易支付异步通知（免登录）。
// 验签通过且处理成功时应答纯文本 success，其余应答会触发网关重试（对齐 PaymentNotifyController）。
func (h *Handler) notify(c *gin.Context) {
	// 用 %s 占位避免应答串中的 % 被当作格式化指令（应答固定为 success/fail，仍按惯例显式占位）。
	c.String(200, "%s", h.svc.HandleNotify(collectParams(c)))
}

// collectParams 汇总易支付通知参数：GET query 与 POST form 一并收集（对齐 @RequestParam Map<String,String>）。
func collectParams(c *gin.Context) map[string]string {
	params := make(map[string]string)
	// 解析 form（含 query + post body），失败不阻断（GET 无 body）。
	_ = c.Request.ParseForm()
	for k, v := range c.Request.Form {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}
	return params
}
