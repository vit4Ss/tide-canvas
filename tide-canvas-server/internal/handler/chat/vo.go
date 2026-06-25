package chat

import (
	"encoding/json"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for the chat endpoints. Every id / FK field is
// an idgen.ID (serialized as a quoted decimal string); all JSON is camelCase.

// roleUser / roleAI are the two logical message roles surfaced to the frontend.
// The IMMessage model has no role column, so role is DERIVED in the VO: a
// message whose sender is the conversation owner is "user"; any other sender
// (the placeholder assistant) is "ai".
const (
	roleUser = "user"
	roleAI   = "ai"
)

// ConversationVO is the summary view of a conversation.
type ConversationVO struct {
	ID            idgen.ID `json:"id"`
	Title         string   `json:"title"`
	LastMessageAt string   `json:"lastMessageAt"`
	CreateTime    string   `json:"createTime"`
}

// MessageTaskVO is the live status/result of the generation task a 生成台
// assistant message points to (the task is the single source of truth). Attached
// only to assistant messages whose linked task still exists.
type MessageTaskVO struct {
	ID         idgen.ID        `json:"id"`
	Status     int             `json:"status"` // 0 processing,1 success,2 failed,3 cancelled
	Progress   int             `json:"progress"`
	ResultURL  string          `json:"resultUrl"`
	ResultMeta json.RawMessage `json:"resultMeta,omitempty"`
	ErrorMsg   string          `json:"errorMsg"`
}

// MessageVO is a single message within a conversation. Role is derived (see the
// constants above) rather than stored on the model.
type MessageVO struct {
	ID             idgen.ID        `json:"id"`
	ConversationID idgen.ID        `json:"conversationId"`
	Role           string          `json:"role"`
	ContentType    string          `json:"contentType"`
	Content        string          `json:"content"`
	CreateTime     string          `json:"createTime"`
	// TaskID links an assistant message to its generation task; Params is the
	// snapshot stored on the user message; Task is the batch-loaded live task
	// status (nil when the task was deleted/expired → frontend shows 已过期).
	TaskID *idgen.ID       `json:"taskId,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Task   *MessageTaskVO  `json:"task,omitempty"`
}

// toConversationVO maps a persisted conversation to its summary VO.
func toConversationVO(c *model.IMConversation) ConversationVO {
	return ConversationVO{
		ID:            c.ID,
		Title:         c.Title,
		LastMessageAt: formatTimePtr(c.LastMessageAt),
		CreateTime:    formatTime(c.CreateTime),
	}
}

// toMessageVO maps a persisted message to its VO, deriving role from whether the
// sender is the conversation's owner.
func toMessageVO(m *model.IMMessage, ownerID idgen.ID) MessageVO {
	role := roleAI
	if m.SenderID == ownerID {
		role = roleUser
	}
	return MessageVO{
		ID:             m.ID,
		ConversationID: m.ConversationID,
		Role:           role,
		ContentType:    m.ContentType,
		Content:        m.Content,
		CreateTime:     formatTime(m.CreateTime),
		TaskID:         m.TaskID,
		Params:         rawJSONOrNil(m.Params),
	}
}

// rawJSONOrNil returns s as a JSON value when it is non-blank valid JSON,
// otherwise nil (so the omitempty field is dropped).
func rawJSONOrNil(s string) json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" || !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

// toMessageTaskVO maps an AiTask row to the compact live-status VO carried on an
// assistant message.
func toMessageTaskVO(t *model.AiTask) *MessageTaskVO {
	if t == nil {
		return nil
	}
	vo := &MessageTaskVO{
		ID:        t.ID,
		Status:    t.Status,
		Progress:  t.Progress,
		ResultURL: t.ResultUrl,
		ErrorMsg:  t.ErrorMsg,
	}
	if s := strings.TrimSpace(t.ResultMeta); s != "" && json.Valid([]byte(s)) {
		vo.ResultMeta = json.RawMessage(s)
	}
	return vo
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// formatTimePtr renders a *time.Time as RFC3339, or "" for nil / zero.
func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return formatTime(*t)
}
