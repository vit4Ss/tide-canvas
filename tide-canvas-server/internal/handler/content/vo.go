package content

import (
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for content endpoints. Every id / FK field is
// an idgen.ID (serializes as a quoted string). JSON is camelCase.

// HomeFeedVO is the aggregated homepage payload: recent community works and
// the hottest market models.（运营推荐位 banners 已随「发现管理」下线。）
type HomeFeedVO struct {
	Works  []PostLiteVO  `json:"works"`
	Models []ModelLiteVO `json:"models"`
}

// PostLiteVO is a slimmed community post for the home "recent works" rail.
type PostLiteVO struct {
	ID           idgen.ID `json:"id"`
	UserID       idgen.ID `json:"userId"`
	Title        string   `json:"title"`
	CoverUrl     string   `json:"coverUrl"`
	Tags         []string `json:"tags"`
	LikeCount    int      `json:"likeCount"`
	CommentCount int      `json:"commentCount"`
	ViewCount    int      `json:"viewCount"`
	CreateTime   string   `json:"createTime"`
}

// ModelLiteVO is a slimmed market model for the home "hot models" rail.
type ModelLiteVO struct {
	ID       idgen.ID `json:"id"`
	AuthorID idgen.ID `json:"authorId"`
	Name     string   `json:"name"`
	CoverUrl string   `json:"coverUrl"`
	// Type is the media category (text | image | video | audio | 3d); the home
	// marquee uses it to deep-link a model into the right workspace
	// (创作台 image/video/audio vs 对话 text; 3d falls back to the catalog until
	// its dedicated generation workspace is connected).
	Type      string   `json:"type"`
	Tags      []string `json:"tags"`
	Price     string   `json:"price"`
	UseCount  int      `json:"useCount"`
	LikeCount int      `json:"likeCount"`
}

// NotificationVO is one per-user notification (GET /api/notifications).
type NotificationVO struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Type       string   `json:"type"`
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	LinkUrl    string   `json:"linkUrl"`
	RefID      idgen.ID `json:"refId"`
	IsRead     int      `json:"isRead"`
	ReadTime   string   `json:"readTime"`
	CreateTime string   `json:"createTime"`
}

// --- mappers ---

// toPostLiteVO maps a community post to the slimmed home-feed VO.
func toPostLiteVO(p *model.CommunityPost) PostLiteVO {
	return PostLiteVO{
		ID:           p.ID,
		UserID:       p.UserID,
		Title:        p.Title,
		CoverUrl:     p.CoverURL,
		Tags:         splitTags(p.Tags),
		LikeCount:    p.LikeCount,
		CommentCount: p.CommentCount,
		ViewCount:    p.ViewCount,
		CreateTime:   formatTime(p.CreateTime),
	}
}

// toModelLiteVO maps a market model to the slimmed home-feed VO.
func toModelLiteVO(m *model.MarketModel) ModelLiteVO {
	return ModelLiteVO{
		ID:        m.ID,
		AuthorID:  m.AuthorID,
		Name:      m.Name,
		CoverUrl:  m.CoverURL,
		Type:      m.Type,
		Tags:      splitTags(m.Tags),
		Price:     m.Price.String(),
		UseCount:  m.UseCount,
		LikeCount: m.LikeCount,
	}
}

// toNotificationVO maps a notification to its VO.
func toNotificationVO(n *model.Notification) NotificationVO {
	return NotificationVO{
		ID:         n.ID,
		UserID:     n.UserID,
		Type:       n.Type,
		Title:      n.Title,
		Content:    n.Content,
		LinkUrl:    n.LinkURL,
		RefID:      derefID(n.RefID),
		IsRead:     n.IsRead,
		ReadTime:   formatTimePtr(n.ReadTime),
		CreateTime: formatTime(n.CreateTime),
	}
}

// --- small helpers ---

// splitTags parses the comma-separated tags column into a non-nil slice so the
// JSON is always an array, never null.
func splitTags(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// derefID returns the pointed-to ID, or 0 when nil.
func derefID(p *idgen.ID) idgen.ID {
	if p == nil {
		return 0
	}
	return *p
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// formatTimePtr renders a *time.Time as RFC3339, or "" when nil/zero.
func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return formatTime(*t)
}
