package billing

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified
// response envelope, mapping lookup/ownership errors to the frontend codes.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// listPlans handles GET /api/billing/plans (public). Returns []PlanVO.
func (h *handler) listPlans(c *gin.Context) {
	vos, err := h.svc.listPlans()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load plans")
		return
	}
	response.OK(c, vos)
}

// listChannels handles GET /api/billing/channels (public). Returns the
// admin-enabled, cashier-supported pay methods ([]PayChannelVO) so the client
// renders exactly what the 管理后台 支付渠道 configuration allows.
func (h *handler) listChannels(c *gin.Context) {
	vos, err := h.svc.listPayChannels()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load pay channels")
		return
	}
	response.OK(c, vos)
}

// createOrder handles POST /api/orders (auth).
func (h *handler) createOrder(c *gin.Context) {
	var dto CreateOrderDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.createOrder(userID, dto)
	if err != nil {
		switch {
		case errors.Is(err, errBadRequest):
			response.Fail(c, response.CodeBadRequest, "invalid order request")
		case errors.Is(err, errChannelDisabled):
			response.Fail(c, response.CodeBadRequest, "该支付方式暂未开放")
		case errors.Is(err, ErrNotFound):
			response.Fail(c, response.CodeNotFound, "plan or package not found")
		case errors.Is(err, errPayUnavailable):
			response.Fail(c, response.CodeServerError, "payment gateway unavailable")
		default:
			response.Fail(c, response.CodeServerError, "failed to create order")
		}
		return
	}
	response.OK(c, vo)
}

// verify handles POST /api/orders/:id/verify (auth). It is the return_url
// backstop: after the user comes back from the cashier the client calls this so
// a paid order still gets credited even if the gateway's async notify never
// reached us. Idempotent — safe to call repeatedly.
func (h *handler) verify(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	o, err := h.svc.getOrder(id, userID)
	if err != nil {
		h.fail(c, err, "failed to verify order")
		return
	}
	res, err := h.svc.verifyOrder(c.Request.Context(), userID, o.OrderNo)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to verify order")
		return
	}
	response.OK(c, res)
}

// listOrders handles GET /api/orders (auth). Returns a PageData<OrderVO>.
func (h *handler) listOrders(c *gin.Context) {
	var q OrderQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	userID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.listOrders(userID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list orders")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// getOrder handles GET /api/orders/:id (auth).
func (h *handler) getOrder(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.getOrder(id, userID)
	if err != nil {
		h.fail(c, err, "failed to load order")
		return
	}
	response.OK(c, vo)
}

// cancelOrder handles POST /api/orders/:id/cancel (auth).
func (h *handler) cancelOrder(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	if err := h.svc.cancelOrder(id, userID); err != nil {
		h.fail(c, err, "failed to cancel order")
		return
	}
	response.OK[any](c, nil)
}

// notify handles the epay async payment callback (public webhook). The gateway
// delivers it as a GET with query params (epay convention); we also accept a
// POST form. We verify the MD5 sign, settle the order + grant credits
// idempotently, and MUST reply the literal "success" so the gateway stops
// retrying — anything else ("fail") makes it re-deliver.
func (h *handler) notify(c *gin.Context) {
	c.String(http.StatusOK, h.settle(c))
}

// settle collects the callback params (query + form) and runs settlement,
// returning the plain-text body epay expects ("success" | "fail").
func (h *handler) settle(c *gin.Context) string {
	raw := map[string]string{}
	for k, vs := range c.Request.URL.Query() {
		if len(vs) > 0 {
			raw[k] = vs[0]
		}
	}
	// POST form values (if any) fill in / override, covering both delivery modes.
	if err := c.Request.ParseForm(); err == nil {
		for k, vs := range c.Request.PostForm {
			if len(vs) > 0 {
				raw[k] = vs[0]
			}
		}
	}
	if h.svc.settleNotify(raw) {
		return "success"
	}
	return "fail"
}

// fail maps service errors to the appropriate response code. A non-owner is
// treated as not-found so a user cannot probe other users' order ids.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "order not found")
	case errors.Is(err, errForbidden):
		response.Fail(c, response.CodeNotFound, "order not found")
	default:
		response.Fail(c, response.CodeServerError, fallbackMsg)
	}
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid order id")
		return 0, false
	}
	return id, true
}
