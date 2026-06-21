package content

import "strings"

// dto.go defines request payloads / query params for content endpoints. JSON &
// form tags are camelCase to match the frontend wire contract.

// BannerQuery is the query for GET /api/banners. Position is optional; when set
// only banners for that placement key are returned.
type BannerQuery struct {
	Position string `form:"position"`
}

// ArticleQuery is the query for GET /api/blog/articles. categoryId filters by
// category (string snowflake), keyword does a title/summary LIKE.
type ArticleQuery struct {
	PageNum    int    `form:"pageNum"`
	PageSize   int    `form:"pageSize"`
	CategoryID string `form:"categoryId"`
	Keyword    string `form:"keyword"`
}

// normalize applies defaults and clamps for pagination.
func (q *ArticleQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 12
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.CategoryID = strings.TrimSpace(q.CategoryID)
	q.Keyword = strings.TrimSpace(q.Keyword)
}

// offset returns the SQL offset for the current page.
func (q *ArticleQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// NotificationQuery is the query for GET /api/notifications. isRead is optional
// (pointer-less here: -1 means "all", 0 unread, 1 read).
type NotificationQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Type     string `form:"type"`
	// IsRead filters by read state: nil => all, 0 => unread, 1 => read.
	IsRead *int `form:"isRead"`
}

// normalize applies defaults and clamps for pagination.
func (q *NotificationQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Type = strings.TrimSpace(q.Type)
}

// offset returns the SQL offset for the current page.
func (q *NotificationQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
