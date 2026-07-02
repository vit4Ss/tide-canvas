package ai

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler is the AI domain's HTTP layer.
type handler struct {
	svc *service
}

func newHandler(d *app.Deps) *handler {
	return &handler{svc: newService(d)}
}

// listModels GET /api/ai/models -> AiModelVO[]
func (h *handler) listModels(c *gin.Context) {
	rows, err := h.svc.listModels(c.Request.Context())
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load models")
		return
	}
	response.OK(c, rows)
}

// listHandlers GET /api/ai/handlers -> AiHandlerVO[]
func (h *handler) listHandlers(c *gin.Context) {
	rows, err := h.svc.listHandlers(c.Request.Context())
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load handlers")
		return
	}
	response.OK(c, rows)
}

// generate POST /api/ai/generate -> AiTaskVO
func (h *handler) generate(c *gin.Context) {
	var dto generateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	if dto.Handler == "" {
		response.Fail(c, response.CodeBadRequest, "handler is required")
		return
	}
	if dto.ModelID == "" {
		response.Fail(c, response.CodeBadRequest, "modelId is required")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.generate(c.Request.Context(), uid, dto)
	if err != nil {
		switch {
		case errors.Is(err, errNoHandler):
			response.Fail(c, response.CodeHandlerNotFound, "handler not found")
		case errors.Is(err, errNoModel):
			response.Fail(c, response.CodeModelUnavailable, "model unavailable")
		default:
			response.Fail(c, response.CodeServerError, "failed to start generation")
		}
		return
	}
	response.OK(c, vo)
}

// gridSplit POST /api/ai/grid-split -> string[]
func (h *handler) gridSplit(c *gin.Context) {
	var dto gridSplitDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	urls, err := h.svc.gridSplit(c.Request.Context(), dto)
	if err != nil {
		switch {
		case errors.Is(err, errBadGridSplit):
			response.Fail(c, response.CodeBadRequest, "invalid grid split parameters")
		default:
			// Not available server-side; the frontend falls back to client slicing.
			// Keep the message generic so the endpoint can't be used to probe the
			// network (SSRF oracle) via differing error text.
			response.Fail(c, response.CodeServerError, "grid split unavailable")
		}
		return
	}
	response.OK(c, urls)
}

// getTask GET /api/ai/tasks/:id -> AiTaskVO
func (h *handler) getTask(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid task id")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.getTask(c.Request.Context(), uid, id)
	if err != nil {
		switch {
		case errors.Is(err, errTaskNotFound):
			response.Fail(c, response.CodeNotFound, "task not found")
		case errors.Is(err, errTaskForbidden):
			response.Fail(c, response.CodeForbidden, "not allowed")
		default:
			response.Fail(c, response.CodeServerError, "failed to load task")
		}
		return
	}
	response.OK(c, vo)
}

// cancelTask DELETE /api/ai/tasks/:id -> void
func (h *handler) cancelTask(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid task id")
		return
	}
	uid := middleware.CurrentUserID(c)
	if err := h.svc.cancelTask(c.Request.Context(), uid, id); err != nil {
		switch {
		case errors.Is(err, errTaskNotFound):
			response.Fail(c, response.CodeNotFound, "task not found")
		case errors.Is(err, errTaskForbidden):
			response.Fail(c, response.CodeForbidden, "not allowed")
		default:
			response.Fail(c, response.CodeServerError, "failed to cancel task")
		}
		return
	}
	response.OK[any](c, nil)
}

// listTasks GET /api/ai/tasks -> PageData<AiTaskVO>
func (h *handler) listTasks(c *gin.Context) {
	var q taskQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query")
		return
	}
	uid := middleware.CurrentUserID(c)
	offset, limit := pagination(q.PageNum, q.PageSize)
	rows, total, err := h.svc.listTasks(c.Request.Context(), uid, q, offset, limit)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list tasks")
		return
	}
	response.Page(c, rows, total, normPage(q.PageNum), limit)
}

// listLogs GET /api/ai/logs -> PageData<AiGenerationLogVO>
func (h *handler) listLogs(c *gin.Context) {
	var q logQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query")
		return
	}
	uid := middleware.CurrentUserID(c)
	isAdmin := middleware.CurrentRole(c) == middleware.AdminRole
	offset, limit := pagination(q.PageNum, q.PageSize)
	rows, total, err := h.svc.listLogs(c.Request.Context(), uid, isAdmin, q, offset, limit)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list logs")
		return
	}
	response.Page(c, rows, total, normPage(q.PageNum), limit)
}

// normPage normalizes a page number for the response echo.
func normPage(pageNum int) int {
	if pageNum <= 0 {
		return 1
	}
	return pageNum
}
