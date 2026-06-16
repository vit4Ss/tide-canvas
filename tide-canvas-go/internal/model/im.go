package model

import (
	"time"

	"gorm.io/datatypes"
)

// 会话类型（im_conversation.type）。
const (
	ConvTypePrivate = "private" // 用户私信（1v1）
	ConvTypeSupport = "support" // 用户 ↔ 客服
	ConvTypeStaff   = "staff"   // 后台使用者之间
)

// 客服会话状态（im_conversation.status，仅 support 用）。
const (
	SupportStatusWaiting = 0 // 待接入
	SupportStatusActive  = 1 // 进行中
	SupportStatusClosed  = 2 // 已结束
)

// 会话内成员角色（im_conversation_member.role）。
const (
	MemberRoleNormal = 0 // 普通成员
	MemberRoleAgent  = 1 // 客服
	MemberRoleOwner  = 2 // 群主/发起者
)

// 消息内容类型（im_message.content_type）。
const (
	MsgTypeText   = "text"
	MsgTypeImage  = "image"
	MsgTypeFile   = "file"
	MsgTypeSystem = "system"
)

// 消息状态（im_message.status）。
const (
	MsgStatusNormal   = 0 // 正常
	MsgStatusRecalled = 1 // 已撤回
)

// ImConversation IM 会话表 im_conversation。统一私信/客服/后台三类会话。
type ImConversation struct {
	PublicModel
	Type            string     `json:"type" gorm:"column:type"`
	Title           string     `json:"title" gorm:"column:title"`
	OwnerID         *int64     `json:"-" gorm:"column:owner_id"`
	AssigneeID      *int64     `json:"-" gorm:"column:assignee_id"`
	Status          int        `json:"status" gorm:"column:status"`
	MemberCount     int        `json:"memberCount" gorm:"column:member_count"`
	LastMessageID   *int64     `json:"-" gorm:"column:last_message_id"`
	LastMessageText string     `json:"lastMessageText" gorm:"column:last_message_text"`
	LastMessageTime *time.Time `json:"lastMessageTime" gorm:"column:last_message_time"`
}

// TableName 表名。
func (ImConversation) TableName() string { return "im_conversation" }

// ImConversationMember IM 会话成员表 im_conversation_member。
type ImConversationMember struct {
	SoftDeleteModel
	ConversationID    int64 `json:"-" gorm:"column:conversation_id"`
	UserID            int64 `json:"-" gorm:"column:user_id"`
	Role              int   `json:"role" gorm:"column:role"`
	LastReadMessageID int64 `json:"-" gorm:"column:last_read_message_id"`
	UnreadCount       int   `json:"unreadCount" gorm:"column:unread_count"`
	Muted             int   `json:"muted" gorm:"column:muted"`
	Removed           int   `json:"-" gorm:"column:removed"`
}

// TableName 表名。
func (ImConversationMember) TableName() string { return "im_conversation_member" }

// ImMessage IM 消息表 im_message。
type ImMessage struct {
	PublicModel
	ConversationID int64          `json:"-" gorm:"column:conversation_id"`
	SenderID       *int64         `json:"-" gorm:"column:sender_id"`
	ContentType    string         `json:"contentType" gorm:"column:content_type"`
	Content        string         `json:"content" gorm:"column:content"`
	Extra          datatypes.JSON `json:"extra" gorm:"column:extra"`
	Status         int            `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (ImMessage) TableName() string { return "im_message" }

// ImUserStatus IM 用户在线状态表 im_user_status（last_seen 持久化；实时在线以 WS 连接为准）。
type ImUserStatus struct {
	BaseModel
	UserID       int64      `json:"-" gorm:"column:user_id"`
	Online       int        `json:"online" gorm:"column:online"`
	LastSeenTime *time.Time `json:"lastSeenTime" gorm:"column:last_seen_time"`
}

// TableName 表名。
func (ImUserStatus) TableName() string { return "im_user_status" }
