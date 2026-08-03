package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// IMConversation is a chat conversation (/api/im, WebSocket /ws/im).
type IMConversation struct {
	BaseModel

	// Type: single (1:1) / group / ai.
	Type    string   `gorm:"column:type;type:varchar(16);not null;default:'single'" json:"type"`
	Title   string   `gorm:"column:title;type:varchar(128)" json:"title"`
	Avatar  string   `gorm:"column:avatar;type:varchar(512)" json:"avatar"`
	OwnerID idgen.ID `gorm:"column:owner_id;index" json:"ownerId"`

	LastMessageID *idgen.ID  `gorm:"column:last_message_id" json:"lastMessageId"`
	LastMessageAt *time.Time `gorm:"column:last_message_at" json:"lastMessageAt"`

	// ContextSummary 是上下文自动压缩（compaction）的滚动摘要：会话估算 token
	// 达到阈值后，较早的消息被文本模型压缩进这段摘要，以 system 消息注入后续
	// 请求；SummaryUptoID 记录摘要已覆盖到的最后一条消息 id，其后的消息仍以
	// 原文进上下文。两个字段只服务于 LLM 上下文，不进任何 VO。
	ContextSummary string   `gorm:"column:context_summary;type:text" json:"-"`
	SummaryUptoID  idgen.ID `gorm:"column:summary_upto_id;not null;default:0" json:"-"`
}

// TableName overrides the default pluralization.
func (IMConversation) TableName() string { return "im_conversation" }

// IMConversationMember links a user to a conversation (unique per pair).
type IMConversationMember struct {
	BaseModel

	ConversationID idgen.ID `gorm:"column:conversation_id;index:idx_conv_user,unique;not null" json:"conversationId"`
	UserID         idgen.ID `gorm:"column:user_id;index:idx_conv_user,unique;not null" json:"userId"`
	// Role: 0 成员 / 1 管理员 / 2 群主.
	Role         int        `gorm:"column:role;type:tinyint;not null;default:0" json:"role"`
	UnreadCount  int        `gorm:"column:unread_count;type:int;not null;default:0" json:"unreadCount"`
	LastReadID   *idgen.ID  `gorm:"column:last_read_id" json:"lastReadId"`
	LastReadTime *time.Time `gorm:"column:last_read_time" json:"lastReadTime"`
}

// TableName overrides the default pluralization.
func (IMConversationMember) TableName() string { return "im_conversation_member" }

// IMMessage is a single message within a conversation.
type IMMessage struct {
	BaseModel

	ConversationID idgen.ID `gorm:"column:conversation_id;index;not null;uniqueIndex:idx_im_message_request,priority:1" json:"conversationId"`
	SenderID       idgen.ID `gorm:"column:sender_id;index;not null;uniqueIndex:idx_im_message_request,priority:2" json:"senderId"`
	// ContentType: text / image / file / system.
	ContentType string `gorm:"column:content_type;type:varchar(16);not null;default:'text'" json:"contentType"`
	Content     string `gorm:"column:content;type:text" json:"content"`
	// Status: 0 已发送 / 1 已撤回.
	Status int `gorm:"column:status;type:tinyint;not null;default:0" json:"status"`
	// TaskID links a 生成台 assistant message to its generation task (ai_tasks).
	// The task is the single source of truth for status/result; the assistant
	// message stores no product, only this pointer. Null for text/user messages.
	TaskID *idgen.ID `gorm:"column:task_id;index" json:"taskId,omitempty"`
	// SkillRunID links an assistant run-card message to a durable multi-step
	// SkillRun. It coexists with TaskID so legacy single-generation turns remain
	// unchanged.
	SkillRunID *idgen.ID `gorm:"column:skill_run_id;index" json:"skillRunId,omitempty"`
	// ClientRequestID correlates a text-chat request across an ambiguous SSE
	// disconnect. It is set on both the user and assistant rows. Including
	// sender_id in the nullable unique index permits exactly one row per role
	// while fencing concurrent retries before a second provider call/charge.
	ClientRequestID *string `gorm:"column:client_request_id;type:varchar(96);uniqueIndex:idx_im_message_request,priority:3" json:"clientRequestId,omitempty"`
	// RequestLeaseUntil is the cross-instance generation lease carried by the
	// user row of an idempotent text turn. A retry may resume the durable request
	// only after this timestamp, using a conditional UPDATE as the atomic claim.
	RequestLeaseUntil *time.Time `gorm:"column:request_lease_until" json:"-"`
	// RequestLeaseToken is the CAS owner of RequestLeaseUntil. Releases from a
	// slow, expired worker match this token and therefore cannot clear the lease
	// already transferred to a recovery worker.
	RequestLeaseToken *idgen.ID `gorm:"column:request_lease_token" json:"-"`
	// RequestChargeRefID/Cost persist the one successful debit with the request.
	// A process-restart recovery reuses these values for an idempotent refund and
	// never charges the user a second time.
	RequestChargeRefID *idgen.ID `gorm:"column:request_charge_ref_id" json:"-"`
	RequestChargeCost  int       `gorm:"column:request_charge_cost;type:int;not null;default:0" json:"-"`
	// RequestSnapshot contains the server-resolved model, skill prompt and
	// attachments needed to resume after a restart. It is deliberately excluded
	// from JSON because a published skill's system prompt is not public data.
	RequestSnapshot string `gorm:"column:request_snapshot;type:longtext" json:"-"`
	// Params is the generation parameter snapshot (JSON) stored on the *user*
	// message of a turn — used to render the result detail row and to power
	// 重新编辑 / 再次生成. Empty for plain text messages.
	Params string `gorm:"column:params;type:text" json:"params,omitempty"`
}

// TableName overrides the default pluralization.
func (IMMessage) TableName() string { return "im_message" }
