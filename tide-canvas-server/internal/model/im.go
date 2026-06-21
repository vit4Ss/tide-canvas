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

	ConversationID idgen.ID `gorm:"column:conversation_id;index;not null" json:"conversationId"`
	SenderID       idgen.ID `gorm:"column:sender_id;index;not null" json:"senderId"`
	// ContentType: text / image / file / system.
	ContentType string `gorm:"column:content_type;type:varchar(16);not null;default:'text'" json:"contentType"`
	Content     string `gorm:"column:content;type:text" json:"content"`
	// Status: 0 已发送 / 1 已撤回.
	Status int `gorm:"column:status;type:tinyint;not null;default:0" json:"status"`
}

// TableName overrides the default pluralization.
func (IMMessage) TableName() string { return "im_message" }
