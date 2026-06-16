package im

import "time"

// ---------- 请求 ----------

// OpenPrivateReq 发起/打开私信会话。
type OpenPrivateReq struct {
	PeerID string `json:"peerId" binding:"required"` // 对方用户 public_id
}

// OpenStaffReq 发起后台会话（1 个成员=1v1，多个=群聊）。
type OpenStaffReq struct {
	MemberIDs []string `json:"memberIds" binding:"required,min=1"` // 成员用户 public_id
	Title     string   `json:"title"`
}

// SendMessageReq 发送消息（REST 入口；WS 上行见 InboundMsg）。
type SendMessageReq struct {
	ConversationID string                 `json:"conversationId" binding:"required"` // 会话 public_id
	ContentType    string                 `json:"contentType"`                        // 缺省 text
	Content        string                 `json:"content" binding:"required"`
	Extra          map[string]interface{} `json:"extra"`
}

// MarkReadReq 标记会话已读到某条消息。
type MarkReadReq struct {
	ConversationID string `json:"conversationId" binding:"required"`
	LastReadID     string `json:"lastReadMessageId"` // 已读到的消息 public_id；空=已读到最新
}

// PageQuery 通用分页（会话/消息列表）。
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// Normalize 归一分页参数（默认 20，上限 100）。
func (q *PageQuery) Normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// ---------- 视图 ----------

// UserBriefVO 用户摘要（对外 public_id + 在线状态）。
type UserBriefVO struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
	Online   bool   `json:"online"`
}

// ConversationVO 会话视图。
type ConversationVO struct {
	ID              string        `json:"id"`
	Type            string        `json:"type"`
	Title           string        `json:"title"`
	Status          int           `json:"status"`
	Peer            *UserBriefVO  `json:"peer,omitempty"`    // 1v1（私信/客服）时的对端
	Members         []UserBriefVO `json:"members,omitempty"` // 群/客服多方时的成员
	Unread          int           `json:"unread"`
	LastMessageText string        `json:"lastMessageText"`
	LastMessageTime *time.Time    `json:"lastMessageTime"`
	UpdateTime      time.Time     `json:"updateTime"`
}

// MessageVO 消息视图。
type MessageVO struct {
	ID             string       `json:"id"`
	ConversationID string       `json:"conversationId"`
	Sender         *UserBriefVO `json:"sender,omitempty"`
	ContentType    string       `json:"contentType"`
	Content        string       `json:"content"`
	Extra          interface{}  `json:"extra,omitempty"`
	Status         int          `json:"status"`
	CreateTime     time.Time    `json:"createTime"`
}

// UserStatusVO 用户在线状态视图。
type UserStatusVO struct {
	ID       string     `json:"id"`
	Online   bool       `json:"online"`
	LastSeen *time.Time `json:"lastSeen"`
}

// ---------- WebSocket 下行事件（服务端 → 客户端）----------

const (
	EventMessage = "message" // 新消息
	EventRead    = "read"    // 已读回执
	EventOnline  = "online"  // 成员上线
	EventOffline = "offline" // 成员下线
	EventSystem  = "system"  // 系统通知（如客服已接入）
)

// WSEvent 下行事件统一信封。
type WSEvent struct {
	Type           string      `json:"type"`
	ConversationID string      `json:"conversationId,omitempty"`
	Message        *MessageVO  `json:"message,omitempty"`
	UserID         string      `json:"userId,omitempty"` // online/offline/read 关联用户 public_id
	Data           interface{} `json:"data,omitempty"`
}

// ---------- WebSocket 上行消息（客户端 → 服务端）----------

const (
	InboundSend = "send" // 发消息
	InboundRead = "read" // 标记已读
)

// InboundMsg WS 上行消息体。
type InboundMsg struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId"`
	ContentType    string `json:"contentType"`
	Content        string `json:"content"`
	LastReadID     string `json:"lastReadMessageId"`
}
