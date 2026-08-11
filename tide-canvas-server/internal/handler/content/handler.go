package content

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified
// response envelope.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// --- site footer ---

// footerLinks handles GET /api/site/footer (public). Returns the admin-
// configured footer link columns (sys_config site.footerLinks，后台「配置管理」
// 可编辑) with the factory default as fallback — never empty.
func (h *handler) footerLinks(c *gin.Context) {
	response.OK(c, h.svc.footerLinks())
}

// homeGlobal handles GET /api/site/home-config (public). Returns the admin-
// configured homepage globals（背景流光 + 首屏 CTA，后台「首页楼层」panel）
// with the factory default as fallback — never empty.
func (h *handler) homeGlobal(c *gin.Context) {
	response.OK(c, h.svc.homeGlobal())
}

// siteFloors handles GET /api/site/floors (public). Returns the enabled home
// floors（后台「首页楼层」管理）in display order — the homepage renders its
// sections from this list.
func (h *handler) siteFloors(c *gin.Context) {
	vos, err := h.svc.siteFloors()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load floors")
		return
	}
	response.OK(c, vos)
}

// --- home feed ---

// homeFeed handles GET /api/home/feed (public).
func (h *handler) homeFeed(c *gin.Context) {
	feed, err := h.svc.homeFeed()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load home feed")
		return
	}
	response.OK(c, feed)
}

// homeWorkCovers handles GET /api/home/work-covers (public). It is a narrow
// projection for smart-tool card fallbacks and does not include model data.
func (h *handler) homeWorkCovers(c *gin.Context) {
	covers, err := h.svc.homeWorkCovers()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load home work covers")
		return
	}
	response.OK(c, covers)
}

// --- notifications (auth) ---

// listNotifications handles GET /api/notifications (auth, paged).
func (h *handler) listNotifications(c *gin.Context) {
	var q NotificationQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()
	userID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.listNotifications(userID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list notifications")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// unreadCount handles GET /api/notifications/unread-count (auth).
func (h *handler) unreadCount(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	cnt, err := h.svc.unreadCount(userID)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load unread count")
		return
	}
	response.OK(c, gin.H{"count": cnt})
}

// readOne handles POST /api/notifications/items/:id/read (auth).
func (h *handler) readOne(c *gin.Context) {
	id, ok := parseID(c, "notification")
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	if err := h.svc.markRead(userID, id); err != nil {
		h.failNotif(c, err)
		return
	}
	response.OK[any](c, nil)
}

// readAll handles POST /api/notifications/read-all (auth).
func (h *handler) readAll(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	if err := h.svc.markAllRead(userID); err != nil {
		response.Fail(c, response.CodeServerError, "failed to mark all read")
		return
	}
	response.OK[any](c, nil)
}

// deleteOne handles DELETE /api/notifications/items/:id (auth).
func (h *handler) deleteOne(c *gin.Context) {
	id, ok := parseID(c, "notification")
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	if err := h.svc.deleteNotification(userID, id); err != nil {
		h.failNotif(c, err)
		return
	}
	response.OK[any](c, nil)
}

// --- helpers ---

// failNotif maps notification service errors to response codes.
func (h *handler) failNotif(c *gin.Context, err error) {
	if errors.Is(err, ErrNotFound) {
		response.Fail(c, response.CodeNotFound, "notification not found")
		return
	}
	response.Fail(c, response.CodeServerError, "operation failed")
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
// entity names the resource for the error message ("article"/"notification").
func parseID(c *gin.Context, entity string) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid "+entity+" id")
		return 0, false
	}
	return id, true
}
