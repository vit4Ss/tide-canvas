package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified response
// envelope, mapping ownership/lookup errors to the frontend codes.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// listConversations handles GET /api/im/conversations (auth).
func (h *handler) listConversations(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	ownerID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.listConversations(ownerID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list conversations")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// createConversation handles POST /api/im/conversations (auth).
func (h *handler) createConversation(c *gin.Context) {
	var dto CreateConversationDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.createConversation(ownerID, dto)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to create conversation")
		return
	}
	response.OK(c, vo)
}

// renameConversation handles PUT /api/im/conversations/:id (auth).
func (h *handler) renameConversation(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto RenameConversationDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.renameConversation(id, ownerID, dto.Title)
	if err != nil {
		h.fail(c, err, "failed to rename conversation")
		return
	}
	response.OK(c, vo)
}

// removeConversation handles DELETE /api/im/conversations/:id (auth).
func (h *handler) removeConversation(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	if err := h.svc.deleteConversation(id, ownerID); err != nil {
		h.fail(c, err, "failed to delete conversation")
		return
	}
	response.OK[any](c, nil)
}

// listMessages handles GET /api/im/conversations/:id/messages (auth).
func (h *handler) listMessages(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	ownerID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.listMessages(id, ownerID, &q)
	if err != nil {
		h.fail(c, err, "failed to load messages")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// sendMessage handles POST /api/im/conversations/:id/messages (auth).
func (h *handler) sendMessage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto SendMessageDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.sendMessage(id, ownerID, dto)
	if err != nil {
		h.fail(c, err, "failed to send message")
		return
	}
	response.OK(c, vo)
}

// appendMessage handles POST /api/im/conversations/:id/messages/append (auth):
// records one message (user prompt or generated media) without an auto reply.
func (h *handler) appendMessage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto AppendMessageDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.appendMessage(id, ownerID, dto)
	if err != nil {
		h.fail(c, err, "failed to append message")
		return
	}
	response.OK(c, vo)
}

// persistTurn handles POST /api/im/conversations/:id/turn (auth): records a
// completed 生成台 turn (user prompt + param snapshot + assistant task pointer).
// Returns the two persisted messages.
func (h *handler) persistTurn(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto PersistTurnDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	taskID, perr := idgen.Parse(dto.TaskID)
	if perr != nil || taskID == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid taskId")
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vos, err := h.svc.persistTurn(id, ownerID, dto, taskID)
	if err != nil {
		h.fail(c, err, "failed to persist turn")
		return
	}
	response.OK(c, vos)
}

// streamMessage handles POST /api/im/conversations/:id/stream (auth): a
// text-model chat reply streamed back as Server-Sent Events. Each frame is a
// JSON object: {"delta":"…"} per token, then {"done":true,"message":{…}}, or
// {"error":"…"} on failure.
func (h *handler) streamMessage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto SendMessageDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ownerID := middleware.CurrentUserID(c)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // disable proxy buffering
	flusher, _ := c.Writer.(http.Flusher)

	frame := func(obj any) {
		b, _ := json.Marshal(obj)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	vo, err := h.svc.streamMessage(c.Request.Context(), id, ownerID, dto.Content, func(delta string) {
		frame(map[string]string{"delta": delta})
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, errForbidden) {
			frame(map[string]string{"error": "对话不存在"})
		} else {
			frame(map[string]string{"error": "生成失败"})
		}
		return
	}
	frame(map[string]any{"done": true, "message": vo})
}

// markRead handles POST /api/im/conversations/:id/read (auth).
func (h *handler) markRead(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	if err := h.svc.markRead(id, ownerID); err != nil {
		h.fail(c, err, "failed to mark conversation read")
		return
	}
	response.OK[any](c, nil)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "conversation not found")
	case errors.Is(err, errForbidden):
		// Hide existence: treat a non-owner as not found so IDs cannot be probed.
		response.Fail(c, response.CodeNotFound, "conversation not found")
	default:
		response.Fail(c, response.CodeServerError, fallbackMsg)
	}
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid conversation id")
		return 0, false
	}
	return id, true
}
