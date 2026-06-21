package content

import (
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for content endpoints. Every id / FK field is
// an idgen.ID (serializes as a quoted string). JSON is camelCase.

// BannerVO is one promotional banner (GET /api/banners, embedded in home feed).
type BannerVO struct {
	ID        idgen.ID `json:"id"`
	Title     string   `json:"title"`
	ImageUrl  string   `json:"imageUrl"`
	LinkUrl   string   `json:"linkUrl"`
	Position  string   `json:"position"`
	SortOrder int      `json:"sortOrder"`
}

// HomeFeedVO is the aggregated homepage payload: carousel banners, recent
// community works, and the hottest market models.
type HomeFeedVO struct {
	Banners []BannerVO     `json:"banners"`
	Works   []PostLiteVO   `json:"works"`
	Models  []ModelLiteVO  `json:"models"`
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
	ID        idgen.ID `json:"id"`
	AuthorID  idgen.ID `json:"authorId"`
	Name      string   `json:"name"`
	CoverUrl  string   `json:"coverUrl"`
	Tags      []string `json:"tags"`
	Price     string   `json:"price"`
	UseCount  int      `json:"useCount"`
	LikeCount int      `json:"likeCount"`
}

// BlogCategoryVO is one visible blog category (GET /api/blog/categories).
type BlogCategoryVO struct {
	ID        idgen.ID `json:"id"`
	Name      string   `json:"name"`
	Slug      string   `json:"slug"`
	SortOrder int      `json:"sortOrder"`
}

// ArticleVO is the blog article summary (list view, no body content).
type ArticleVO struct {
	ID          idgen.ID `json:"id"`
	CategoryID  idgen.ID `json:"categoryId"`
	AuthorID    idgen.ID `json:"authorId"`
	Title       string   `json:"title"`
	Slug        string   `json:"slug"`
	Summary     string   `json:"summary"`
	CoverUrl    string   `json:"coverUrl"`
	ViewCount   int      `json:"viewCount"`
	PublishTime string   `json:"publishTime"`
	CreateTime  string   `json:"createTime"`
}

// ArticleDetailVO is the full blog article (GET /api/blog/articles/:id),
// extending the summary with the rendered content body.
type ArticleDetailVO struct {
	ArticleVO
	Content string `json:"content"`
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

// toBannerVO maps a persisted banner to its VO.
func toBannerVO(b *model.Banner) BannerVO {
	return BannerVO{
		ID:        b.ID,
		Title:     b.Title,
		ImageUrl:  b.ImageURL,
		LinkUrl:   b.LinkURL,
		Position:  b.Position,
		SortOrder: b.SortOrder,
	}
}

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
		Tags:      splitTags(m.Tags),
		Price:     m.Price.String(),
		UseCount:  m.UseCount,
		LikeCount: m.LikeCount,
	}
}

// toBlogCategoryVO maps a blog category to its VO.
func toBlogCategoryVO(c *model.BlogCategory) BlogCategoryVO {
	return BlogCategoryVO{
		ID:        c.ID,
		Name:      c.Name,
		Slug:      c.Slug,
		SortOrder: c.SortOrder,
	}
}

// toArticleVO maps a blog article to its summary VO.
func toArticleVO(a *model.BlogArticle) ArticleVO {
	return ArticleVO{
		ID:          a.ID,
		CategoryID:  derefID(a.CategoryID),
		AuthorID:    a.AuthorID,
		Title:       a.Title,
		Slug:        a.Slug,
		Summary:     a.Summary,
		CoverUrl:    a.CoverURL,
		ViewCount:   a.ViewCount,
		PublishTime: formatTimePtr(a.PublishTime),
		CreateTime:  formatTime(a.CreateTime),
	}
}

// toArticleDetailVO maps a blog article to its full detail VO.
func toArticleDetailVO(a *model.BlogArticle) ArticleDetailVO {
	return ArticleDetailVO{
		ArticleVO: toArticleVO(a),
		Content:   a.Content,
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
