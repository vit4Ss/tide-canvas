package model

import (
	"time"

	"gorm.io/datatypes"
)

// AiConversation is a private, persistent text/image/video creation session.
type AiConversation struct {
	PublicModel
	UserID              int64      `json:"-" gorm:"column:user_id"`
	Mode                string     `json:"mode" gorm:"column:mode"`
	Title               string     `json:"title" gorm:"column:title"`
	Pinned              int        `json:"pinned" gorm:"column:pinned"`
	ActiveLeafMessageID *int64     `json:"-" gorm:"column:active_leaf_message_id"`
	LastMessageTime     *time.Time `json:"lastMessageTime" gorm:"column:last_message_time"`
}

func (AiConversation) TableName() string { return "ai_conversation" }

// AiConversationMessage forms a branch-aware message tree through ParentMessageID.
type AiConversationMessage struct {
	PublicModel
	ConversationID  int64          `json:"-" gorm:"column:conversation_id"`
	ParentMessageID *int64         `json:"-" gorm:"column:parent_message_id"`
	Role            string         `json:"role" gorm:"column:role"`
	ContentType     string         `json:"contentType" gorm:"column:content_type"`
	Content         string         `json:"content" gorm:"column:content"`
	ModelID         *int64         `json:"-" gorm:"column:model_id"`
	ModelName       string         `json:"modelName" gorm:"column:model_name"`
	TaskID          *int64         `json:"-" gorm:"column:task_id"`
	Status          string         `json:"status" gorm:"column:status"`
	Metadata        datatypes.JSON `json:"metadata" gorm:"column:metadata"`
}

func (AiConversationMessage) TableName() string { return "ai_conversation_message" }

// AiMessageFile binds uploaded inputs and generated outputs to a message.
type AiMessageFile struct {
	BaseModel
	MessageID int64          `json:"-" gorm:"column:message_id"`
	FileID    int64          `json:"-" gorm:"column:file_id"`
	Relation  string         `json:"relation" gorm:"column:relation"`
	Locator   datatypes.JSON `json:"locator" gorm:"column:locator"`
}

func (AiMessageFile) TableName() string { return "ai_message_file" }

// SysFileReference ensures one physical file can be reused without double-counting storage.
type SysFileReference struct {
	BaseModel
	UserID  int64  `json:"-" gorm:"column:user_id"`
	FileID  int64  `json:"-" gorm:"column:file_id"`
	BizType string `json:"bizType" gorm:"column:biz_type"`
	BizID   int64  `json:"-" gorm:"column:biz_id"`
}

func (SysFileReference) TableName() string { return "sys_file_reference" }

// AiDocument tracks asynchronous extraction/OCR for a conversation attachment.
type AiDocument struct {
	PublicModel
	UserID         int64  `json:"-" gorm:"column:user_id"`
	FileID         int64  `json:"-" gorm:"column:file_id"`
	Status         string `json:"status" gorm:"column:status"`
	PageCount      int    `json:"pageCount" gorm:"column:page_count"`
	CharacterCount int64  `json:"characterCount" gorm:"column:character_count"`
	ErrorMessage   string `json:"errorMessage" gorm:"column:error_message"`
}

func (AiDocument) TableName() string { return "ai_document" }

// AiDocumentChunk stores source-addressable text for retrieval and citations.
type AiDocumentChunk struct {
	BaseModel
	DocumentID int64          `json:"-" gorm:"column:document_id"`
	ChunkIndex int            `json:"chunkIndex" gorm:"column:chunk_index"`
	Content    string         `json:"content" gorm:"column:content"`
	Locator    datatypes.JSON `json:"locator" gorm:"column:locator"`
	TokenCount int            `json:"tokenCount" gorm:"column:token_count"`
	Embedding  []byte         `json:"-" gorm:"column:embedding"`
}

func (AiDocumentChunk) TableName() string { return "ai_document_chunk" }
