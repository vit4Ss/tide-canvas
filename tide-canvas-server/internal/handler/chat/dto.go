package chat

import "encoding/json"

// dto.go defines request payloads for the chat endpoints. JSON tags are
// camelCase so the wire contract matches the frontend.

// CreateConversationDTO is the body for POST /api/im/conversations. The title is
// optional; when blank the service assigns a default title.
type CreateConversationDTO struct {
	Title string `json:"title" binding:"omitempty,max=128"`
}

// SendMessageDTO is the body for POST /api/im/conversations/:id/messages. Type
// is the message content type (text / image / file); it defaults to "text".
type SendMessageDTO struct {
	Content string `json:"content" binding:"required,max=8192"`
	Type    string `json:"type" binding:"omitempty,oneof=text image file"`
}

// AppendMessageDTO is the body for POST /api/im/conversations/:id/messages/append.
// It records ONE message verbatim with no auto assistant reply — used by 对话式
// 生成 to log the user's prompt and the generated media result. Role is "user"
// (default) or "ai"; Type is the content type (text / image / video / file).
type AppendMessageDTO struct {
	Role    string `json:"role" binding:"omitempty,oneof=user ai"`
	Content string `json:"content" binding:"required,max=8192"`
	Type    string `json:"type" binding:"omitempty,oneof=text image video file"`
}

// PersistTurnDTO records a completed 生成台 turn: the user prompt + its param
// snapshot + the generation task it produced. The assistant message stores only
// taskId. ContentType is the result media kind (image | video, default image).
type PersistTurnDTO struct {
	Prompt      string          `json:"prompt" binding:"required,max=8192"`
	Params      json.RawMessage `json:"params"`
	TaskID      string          `json:"taskId" binding:"required"`
	ContentType string          `json:"contentType" binding:"omitempty,oneof=image video"`
}

// ListQuery is the pagination query for the conversation list and the message
// history (PageQuery).
type ListQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize applies defaults and clamps for pagination.
func (q *ListQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// offset returns the SQL offset for the current page.
func (q *ListQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
