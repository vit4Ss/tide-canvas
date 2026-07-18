// Package conversation persists private AI creation sessions and branch-aware messages.
package conversation

import (
	"encoding/json"
	"strings"
	"time"
)

const (
	ModeText  = "text"
	ModeImage = "image"
	ModeVideo = "video"
)

type ListQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

func (q *ListQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 30
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

type CreateDTO struct {
	Mode string `json:"mode" binding:"required"`
}

type UpdateDTO struct {
	Title               *string `json:"title"`
	Pinned              *bool   `json:"pinned"`
	ActiveLeafMessageID *string `json:"activeLeafMessageId"`
}

type MessageFileDTO struct {
	FileID   string         `json:"fileId" binding:"required"`
	Relation string         `json:"relation"`
	Locator  map[string]any `json:"locator"`
}

type AppendMessageDTO struct {
	ParentMessageID string           `json:"parentMessageId"`
	Role            string           `json:"role" binding:"required"`
	ContentType     string           `json:"contentType"`
	Content         string           `json:"content"`
	ModelID         string           `json:"modelId"`
	ModelName       string           `json:"modelName"`
	TaskID          string           `json:"taskId"`
	Status          string           `json:"status"`
	Metadata        map[string]any   `json:"metadata"`
	Files           []MessageFileDTO `json:"files"`
}

type UpdateMessageDTO struct {
	Content   *string         `json:"content"`
	Status    *string         `json:"status"`
	ModelID   *string         `json:"modelId"`
	ModelName *string         `json:"modelName"`
	TaskID    *string         `json:"taskId"`
	Metadata  *map[string]any `json:"metadata"`
}

type FileVO struct {
	ID           string         `json:"id"`
	OriginalName string         `json:"originalName"`
	FileURL      string         `json:"fileUrl"`
	FileSize     int64          `json:"fileSize"`
	FileType     string         `json:"fileType"`
	MimeType     string         `json:"mimeType"`
	StorageType  string         `json:"storageType"`
	Relation     string         `json:"relation"`
	Locator      map[string]any `json:"locator,omitempty"`
}

type MessageVO struct {
	ID              string         `json:"id"`
	ParentMessageID string         `json:"parentMessageId,omitempty"`
	Role            string         `json:"role"`
	ContentType     string         `json:"contentType"`
	Content         string         `json:"content"`
	ModelID         string         `json:"modelId,omitempty"`
	ModelName       string         `json:"modelName,omitempty"`
	TaskID          string         `json:"taskId,omitempty"`
	Status          string         `json:"status"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	Files           []FileVO       `json:"files"`
	CreateTime      time.Time      `json:"createTime"`
	UpdateTime      time.Time      `json:"updateTime"`
}

type ConversationVO struct {
	ID                  string      `json:"id"`
	Mode                string      `json:"mode"`
	Title               string      `json:"title"`
	Pinned              bool        `json:"pinned"`
	ActiveLeafMessageID string      `json:"activeLeafMessageId,omitempty"`
	LastMessageTime     *time.Time  `json:"lastMessageTime,omitempty"`
	CreateTime          time.Time   `json:"createTime"`
	UpdateTime          time.Time   `json:"updateTime"`
	Messages            []MessageVO `json:"messages,omitempty"`
}

func validMode(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ModeText, ModeImage, ModeVideo:
		return true
	default:
		return false
	}
}

func normalizeMessageRole(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "user", "assistant", "system":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func normalizeMessageStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pending", "streaming", "done", "error", "cancelled":
		return strings.ToLower(strings.TrimSpace(value))
	case "":
		return "done"
	default:
		return ""
	}
}

func normalizeContentType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "text", "image", "video", "status":
		return strings.ToLower(strings.TrimSpace(value))
	case "":
		return "text"
	default:
		return ""
	}
}

func decodeJSONMap(raw []byte) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out
}
