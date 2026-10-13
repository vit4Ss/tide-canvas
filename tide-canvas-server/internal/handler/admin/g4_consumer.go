package admin

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"tidecanvas/internal/handler/billing"
	"tidecanvas/internal/pkg/response"
)

func (h *g4PricingHandler) getConsumerInfo(c *gin.Context) {
	v, err := billing.LoadConsumerInfo(h.db, h.market)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load customer information")
		return
	}
	response.OK(c, v)
}

func (h *g4PricingHandler) saveConsumerInfo(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 50000)
	var v billing.ConsumerInfo
	if err := c.ShouldBindJSON(&v); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid customer information")
		return
	}
	if err := v.Validate(); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := billing.SaveConsumerInfo(h.db, v, h.market); err != nil {
		response.Fail(c, response.CodeServerError, "failed to save customer information")
		return
	}
	response.OK(c, v)
}
