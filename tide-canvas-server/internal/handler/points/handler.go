package points

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified
// response envelope, mapping lookup errors to the frontend codes.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// balance handles GET /api/points/balance (auth). Returns BalanceVO.
func (h *handler) balance(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.balance(userID)
	if err != nil {
		h.fail(c, err, "failed to load balance")
		return
	}
	response.OK(c, vo)
}

// records handles GET /api/points/records (auth). Returns PageData<PointRecordVO>.
func (h *handler) records(c *gin.Context) {
	var q RecordQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	userID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.records(userID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list point records")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// checkinStatus handles GET /api/points/checkin (auth). Returns CheckinStatusVO.
func (h *handler) checkinStatus(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.checkinStatus(userID)
	if err != nil {
		h.fail(c, err, "failed to load check-in status")
		return
	}
	response.OK(c, vo)
}

// checkin handles POST /api/points/checkin (auth). Idempotent per day.
func (h *handler) checkin(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.checkin(userID)
	if err != nil {
		h.fail(c, err, "failed to check in")
		return
	}
	response.OK(c, vo)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "user not found")
	default:
		response.Fail(c, response.CodeServerError, fallbackMsg)
	}
}
