package points

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/eventlog"
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

func (h *handler) redeemActivationCode(c *gin.Context) {
	var dto ActivationCodeRedeemDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "请输入激活码")
		return
	}
	vo, err := h.svc.redeemActivationCode(
		middleware.CurrentUserID(c), dto.Code, c.ClientIP(), eventlog.Truncate(c.GetHeader("User-Agent"), 512),
	)
	if err != nil {
		h.fail(c, err, "failed to redeem activation code")
		return
	}
	response.OK(c, vo)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	var capped *checkinCappedError
	switch {
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "user not found")
	case errors.Is(err, ErrActivationCodeInvalid):
		response.Fail(c, response.CodeBadRequest, "激活码无效，请核对后重试")
	case errors.Is(err, ErrActivationCodeDisabled):
		response.Fail(c, response.CodeBadRequest, "该激活码已停用")
	case errors.Is(err, ErrActivationCodeExpired):
		response.Fail(c, response.CodeBadRequest, "该激活码已过期")
	case errors.Is(err, ErrActivationCodeExhausted):
		response.Fail(c, response.CodeBadRequest, "该激活码的领取次数已用完")
	case errors.Is(err, ErrActivationCodeClaimed):
		response.Fail(c, response.CodeConflict, "你已经领取过该激活码")
	case errors.As(err, &capped):
		// 月度上限业务提示：400 携带可读文案（500 统一话术不适用于业务拒绝）。
		response.Fail(c, response.CodeBadRequest,
			fmt.Sprintf("本月签到积分已达上限（%d 积分），下月再来吧", capped.Cap))
	default:
		response.Fail(c, response.CodeServerError, fallbackMsg)
	}
}
