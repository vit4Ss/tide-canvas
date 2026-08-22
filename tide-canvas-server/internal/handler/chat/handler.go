package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

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
	// 同 /stream：拦下纯空白内容（binding:required 只拦空串）。
	if strings.TrimSpace(dto.Content) == "" {
		response.Fail(c, response.CodeBadRequest, "content is blank")
		return
	}
	if err := validateClientRequestID(dto.ClientRequestID); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid clientRequestId")
		return
	}
	ownerID := middleware.CurrentUserID(c)
	// 请求上下文贯通到压缩与生成：客户端断开即取消，不再空烧上游。
	vo, err := h.svc.sendMessage(c.Request.Context(), id, ownerID, dto)
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
	// 同 /messages、/stream：拦下纯空白内容（binding:required 只拦空串）。
	if strings.TrimSpace(dto.Content) == "" {
		response.Fail(c, response.CodeBadRequest, "content is blank")
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
	// binding:required 只拦空串，纯空白会溜过：trim 后为空的消息落库即成
	// 空文本行，被上下文组装过滤后，多模态附件会错挂到上一条用户消息。
	if strings.TrimSpace(dto.Content) == "" {
		response.Fail(c, response.CodeBadRequest, "content is blank")
		return
	}
	if err := validateClientRequestID(dto.ClientRequestID); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid clientRequestId")
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

	vo, err := h.svc.streamMessage(c.Request.Context(), id, ownerID, dto.Content, dto.Attachments, dto.Model, dto.SkillID, dto.WebSearch, dto.ClientRequestID, func(delta string) {
		frame(map[string]string{"delta": delta})
	})
	if err != nil {
		switch {
		case errors.Is(err, errTextTurnInProgress):
			frame(map[string]any{
				"error":        "上一条消息仍在生成中",
				"code":         "TURN_IN_PROGRESS",
				"retryAfterMs": textTurnRetryAfter(err).Milliseconds(),
			})
		case errors.Is(err, errInvalidSkill):
			frame(map[string]string{"error": "selected skill is unavailable", "code": "SKILL_UNAVAILABLE"})
		case errors.Is(err, ErrNotFound) || errors.Is(err, errForbidden):
			frame(map[string]string{"error": "对话不存在"})
		case errors.Is(err, errContextFull):
			// distinct code so the frontend can surface the 开启新会话 prompt.
			frame(map[string]string{"error": contextFullMsg, "code": "CONTEXT_LIMIT"})
		case errors.Is(err, errInsufficientPoints):
			frame(map[string]string{"error": "积分不足，请充值后再试", "code": "INSUFFICIENT_POINTS"})
		default:
			frame(map[string]string{"error": "生成失败"})
		}
		return
	}
	frame(map[string]any{"done": true, "message": vo})
}

// streamLiveMessage handles GET /api/im/conversations/:id/stream (auth): attach
// to the conversation's in-progress assistant reply (断开重连续播). Frames match
// POST /stream — {"delta"} / {"done","message"} — plus {"none":true} when nothing
// is generating (already persisted / never started / server restarted), which
// tells the client to just reload messages.
func (h *handler) streamLiveMessage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	clientRequestID := c.Query("clientRequestId")
	if err := validateClientRequestID(clientRequestID); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid clientRequestId")
		return
	}
	lr, err := h.svc.attachLive(id, ownerID, clientRequestID)
	if err != nil {
		response.Fail(c, response.CodeNotFound, "对话不存在")
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := c.Writer.(http.Flusher)
	frame := func(obj any) {
		b, _ := json.Marshal(obj)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if lr == nil {
		frame(map[string]bool{"none": true})
		return
	}

	// 快照 + 版本通知消费循环：先补发已生成部分，随后每被唤醒一次按 offset
	// 切片补差，直到终态（done 带落库消息；final 缺失 = 生成异常终止）。
	offset := 0
	for {
		text, wait, done, final := lr.state()
		if len(text) > offset {
			frame(map[string]string{"delta": text[offset:]})
			offset = len(text)
		}
		if done {
			if final != nil {
				frame(map[string]any{"done": true, "message": final})
			} else {
				frame(map[string]string{"error": "生成失败"})
			}
			return
		}
		select {
		case <-wait:
		case <-c.Request.Context().Done():
			return // 附着方又断开了：生成不受影响，下次再附着
		}
	}
}

// contextUsage handles GET /api/im/conversations/:id/context (auth): the
// conversation's estimated context-token usage vs the configured cap.
func (h *handler) contextUsage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	ownerID := middleware.CurrentUserID(c)
	vo, err := h.svc.contextUsage(id, ownerID)
	if err != nil {
		h.fail(c, err, "failed to load context usage")
		return
	}
	response.OK(c, vo)
}

// contextFullMsg is the user-facing message when a conversation hit the
// context-token cap.
const contextFullMsg = "当前会话上下文已达上限，请开启新会话"

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, errInvalidSkill):
		response.Fail(c, response.CodeBadRequest, "selected skill is unavailable")
	case errors.Is(err, ErrNotFound):
		response.Fail(c, response.CodeNotFound, "conversation not found")
	case errors.Is(err, errForbidden):
		// Hide existence: treat a non-owner as not found so IDs cannot be probed.
		response.Fail(c, response.CodeNotFound, "conversation not found")
	case errors.Is(err, errConversationBusy):
		response.Fail(c, response.CodeConflict, "当前对话正在生成，请完成后再试")
	case errors.Is(err, errContextFull):
		response.Fail(c, response.CodeContextLimit, contextFullMsg)
	case errors.Is(err, errInsufficientPoints):
		response.Fail(c, response.CodeQuotaInsufficient, "积分不足，请充值后再试")
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
