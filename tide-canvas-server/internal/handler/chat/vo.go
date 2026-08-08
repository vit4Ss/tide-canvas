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
	ID idgen.ID `json:"id"`
	// ModelID is the persisted market-model row id. Unlike the display name it
	// remains stable when an existing row is renamed or taken off shelf.
	ModelID  idgen.ID `json:"modelId,omitempty"`
	Status   int      `json:"status"` // 0 processing,1 success,2 failed,3 cancelled
	Progress int      `json:"progress"`
	// ModelName is the display name of the model that ran this generation; the
	// chat UI shows it as the result bubble's avatar (模型图标).
	ModelName  string          `json:"modelName"`
	ResultURL  string          `json:"resultUrl"`
	ResultMeta json.RawMessage `json:"resultMeta,omitempty"`
	ErrorMsg   string          `json:"errorMsg"`
}

type MessageSkillRunVO struct {
	ID            idgen.ID        `json:"id"`
	SkillID       idgen.ID        `json:"skillId"`
	Status        string          `json:"status"`
	CurrentStep   string          `json:"currentStep,omitempty"`
	Progress      int             `json:"progress"`
	PendingAction json.RawMessage `json:"pendingAction,omitempty"`
	ErrorMessage  string          `json:"errorMessage,omitempty"`
	PointCost     int64           `json:"pointCost"`
}

// MessageVO is a single message within a conversation. Role is derived (see the
// constants above) rather than stored on the model.
type MessageVO struct {
	ID             idgen.ID `json:"id"`
	ConversationID idgen.ID `json:"conversationId"`
	Role           string   `json:"role"`
	ContentType    string   `json:"contentType"`
	Content        string   `json:"content"`
	CreateTime     string   `json:"createTime"`
	// TaskID links an assistant message to its generation task; Params is the
	// snapshot stored on the user message; Task is the batch-loaded live task
	// status (nil when the task was deleted/expired → frontend shows 已过期).
	TaskID          *idgen.ID          `json:"taskId,omitempty"`
	SkillRunID      *idgen.ID          `json:"skillRunId,omitempty"`
	ClientRequestID *string            `json:"clientRequestId,omitempty"`
	Params          json.RawMessage    `json:"params,omitempty"`
	Task            *MessageTaskVO     `json:"task,omitempty"`
	SkillRun        *MessageSkillRunVO `json:"skillRun,omitempty"`
}

// ContextUsageVO reports a conversation's estimated context-token usage against
// the configured cap (GET /api/im/conversations/:id/context). Percent is
// clamped to [0,100]; Full means new text turns will be rejected; Compressed
// means older history has been auto-compacted into a rolling summary (usage
// counts the summary + the uncompressed tail, not the original transcript).
type ContextUsageVO struct {
	UsedTokens  int  `json:"usedTokens"`
	LimitTokens int  `json:"limitTokens"`
	Percent     int  `json:"percent"`
	Full        bool `json:"full"`
	Compressed  bool `json:"compressed"`
}

// toContextUsageVO builds the usage VO from an estimate and the cap.
func toContextUsageVO(used, limit int, compressed bool) ContextUsageVO {
	pct := 0
	if limit > 0 {
		pct = used * 100 / limit
	}
	if pct > 100 {
		pct = 100
	}
	return ContextUsageVO{
		UsedTokens:  used,
		LimitTokens: limit,
		Percent:     pct,
		Full:        used >= limit,
		Compressed:  compressed,
	}
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
		ID:              m.ID,
		ConversationID:  m.ConversationID,
		Role:            role,
		ContentType:     m.ContentType,
		Content:         m.Content,
		CreateTime:      formatTime(m.CreateTime),
		TaskID:          m.TaskID,
		SkillRunID:      m.SkillRunID,
		ClientRequestID: m.ClientRequestID,
		Params:          rawJSONOrNil(m.Params),
	}
}

func toMessageSkillRunVO(run *model.SkillRun) *MessageSkillRunVO {
	if run == nil {
		return nil
	}
	return &MessageSkillRunVO{ID: run.ID, SkillID: run.SkillID, Status: run.Status,
		CurrentStep: run.CurrentStep, Progress: run.Progress, PendingAction: rawJSONOrNil(run.PendingAction),
		ErrorMessage: run.ErrorMessage, PointCost: run.PointCost}
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
		ModelID:   t.ModelID,
		Status:    t.Status,
		Progress:  t.Progress,
		ModelName: t.ModelName,
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
