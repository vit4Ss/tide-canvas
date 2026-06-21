package market

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified response
// envelope, mapping lookup errors to the frontend codes.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// categories handles GET /api/market/categories (public). Returns []ModelCategoryVO.
func (h *handler) categories(c *gin.Context) {
	vos, err := h.svc.categories()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list categories")
		return
	}
	response.OK(c, vos)
}

// list handles GET /api/market/models (public). Returns PageData<MarketModelVO>.
func (h *handler) list(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	vos, total, err := h.svc.list(&q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list models")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// get handles GET /api/market/models/:id (public). Returns MarketModelVO.
func (h *handler) get(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	vo, err := h.svc.get(id)
	if err != nil {
		h.fail(c, err, "failed to load model")
		return
	}
	response.OK(c, vo)
}

// like handles POST /api/market/models/:id/like (auth).
func (h *handler) like(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	if err := h.svc.like(id); err != nil {
		h.fail(c, err, "failed to like model")
		return
	}
	response.OK[any](c, nil)
}

// use handles POST /api/market/models/:id/use (auth).
func (h *handler) use(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	if err := h.svc.use(id); err != nil {
		h.fail(c, err, "failed to record use")
		return
	}
	response.OK[any](c, nil)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	if errors.Is(err, ErrNotFound) {
		response.Fail(c, response.CodeNotFound, "model not found")
		return
	}
	response.Fail(c, response.CodeServerError, fallbackMsg)
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid model id")
		return 0, false
	}
	return id, true
}
