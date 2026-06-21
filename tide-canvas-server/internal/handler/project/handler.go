package project

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified
// response envelope, mapping ownership/lookup errors to the frontend codes.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// list handles GET /api/projects (auth). Returns a PageData<ProjectVO>.
func (h *handler) list(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	ownerID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.list(ownerID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list projects")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// create handles POST /api/projects (auth).
func (h *handler) create(c *gin.Context) {
	var dto CreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.create(ownerID, dto)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to create project")
		return
	}
	response.OK(c, vo)
}

// get handles GET /api/projects/:id (auth).
func (h *handler) get(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.get(id, ownerID)
	if err != nil {
		h.fail(c, err, "failed to load project")
		return
	}
	response.OK(c, vo)
}

// getByToken handles GET /api/projects/token/:token (public).
func (h *handler) getByToken(c *gin.Context) {
	tok := c.Param("token")
	vo, err := h.svc.getByToken(tok)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Fail(c, response.CodeNotFound, "project not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load project")
		return
	}
	response.OK(c, vo)
}

// update handles PUT /api/projects/:id (auth).
func (h *handler) update(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto UpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.update(id, ownerID, dto)
	if err != nil {
		h.fail(c, err, "failed to update project")
		return
	}
	response.OK(c, vo)
}

// remove handles DELETE /api/projects/:id (auth).
func (h *handler) remove(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	if err := h.svc.remove(id, ownerID); err != nil {
		h.fail(c, err, "failed to delete project")
		return
	}
	response.OK[any](c, nil)
}

// saveCanvas handles PUT /api/projects/:id/canvas (auth).
func (h *handler) saveCanvas(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto CanvasSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	if err := h.svc.saveCanvas(id, ownerID, dto); err != nil {
		h.fail(c, err, "failed to save canvas")
		return
	}
	response.OK[any](c, nil)
}

// getCanvas handles GET /api/projects/:id/canvas (auth).
func (h *handler) getCanvas(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.getCanvas(id, ownerID)
	if err != nil {
		h.fail(c, err, "failed to load canvas")
		return
	}
	response.OK(c, vo)
}

// share handles POST /api/projects/:id/share (auth).
func (h *handler) share(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.share(id, ownerID)
	if err != nil {
		h.fail(c, err, "failed to share project")
		return
	}
	response.OK(c, vo)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "project not found")
	case errors.Is(err, errForbidden):
		// Hide existence: treat as not found so a non-owner cannot probe IDs.
		response.Fail(c, response.CodeNotFound, "project not found")
	default:
		response.Fail(c, response.CodeServerError, fallbackMsg)
	}
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid project id")
		return 0, false
	}
	return id, true
}
