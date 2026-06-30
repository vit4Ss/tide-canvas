package canvas

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 画布项目 HTTP 层（对齐 ProjectController，前缀 /api/projects）。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册项目路由到给定父组（传入 /api 组 → 实际为 /api/projects/*）。整组需登录。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/projects")
	g.Use(middleware.JWTAuth(jwtProvider))

	g.GET("", h.list)
	g.POST("", h.create)
	g.GET("/:id", h.get)
	g.GET("/token/:token", h.getByToken)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.delete)
	g.PUT("/:id/canvas", h.saveCanvas)
	g.GET("/:id/canvas", h.getCanvas)
	g.POST("/:id/share", h.share)
}

func (h *Handler) list(c *gin.Context) {
	var query ProjectQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListProjects(middleware.MustUserID(c), &query)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

func (h *Handler) create(c *gin.Context) {
	var req ProjectCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateProject(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.GetProject(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) getByToken(c *gin.Context) {
	vo, err := h.svc.GetProjectByToken(middleware.MustUserID(c), c.Param("token"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) update(c *gin.Context) {
	var req ProjectUpdateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.UpdateProject(middleware.MustUserID(c), c.Param("id"), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.DeleteProject(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) saveCanvas(c *gin.Context) {
	var req CanvasSaveReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	project, err := h.svc.SaveCanvas(middleware.MustUserID(c), c.Param("id"), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, CanvasDataVO{CanvasData: project.CanvasData, UpdateTime: project.UpdateTime})
}

func (h *Handler) getCanvas(c *gin.Context) {
	project, err := h.svc.GetCanvasData(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	data := project.CanvasData
	// 新建未保存的画布 canvas_data 为空，兜底空对象，避免前端解析空串失败。
	if data == "" {
		data = "{}"
	}
	response.OK(c, CanvasDataVO{CanvasData: data, UpdateTime: project.UpdateTime})
}

func (h *Handler) share(c *gin.Context) {
	token, err := h.svc.ShareProject(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, ShareVO{ShareToken: token, ShareURL: "/share/" + token})
}
