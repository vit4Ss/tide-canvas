package conversation

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/conversations")
	g.Use(middleware.JWTAuth(jwtProvider))
	g.GET("", h.list)
	g.POST("", h.create)
	g.GET("/:id", h.get)
	g.PATCH("/:id", h.update)
	g.DELETE("/:id", h.delete)
	g.POST("/:id/messages", h.appendMessage)
	g.PATCH("/:id/messages/:messageId", h.updateMessage)
}

func (h *Handler) list(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	rows, total, err := h.svc.List(middleware.MustUserID(c), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(rows, total, q.PageNum, q.PageSize))
}

func (h *Handler) create(c *gin.Context) {
	var dto CreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Create(middleware.MustUserID(c), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.Get(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) update(c *gin.Context) {
	var dto UpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Update(middleware.MustUserID(c), c.Param("id"), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.Delete(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) appendMessage(c *gin.Context) {
	var dto AppendMessageDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.AppendMessage(middleware.MustUserID(c), c.Param("id"), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) updateMessage(c *gin.Context) {
	var dto UpdateMessageDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.UpdateMessage(middleware.MustUserID(c), c.Param("id"), c.Param("messageId"), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}
