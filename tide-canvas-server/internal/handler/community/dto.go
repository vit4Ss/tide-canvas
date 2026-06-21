package community

import "strings"

// dto.go defines request payloads and query bindings for the community domain.
// JSON/form tags are camelCase to match the frontend wire contract
// (tide-canvas-web). Every id field is sent/received as a string (idgen.ID).

// FeedQuery is the query for GET /community/posts (paged inspiration feed).
//
//	cat?      filter by category (stored in the post metadata)
//	type?     image|video
//	sort?     hot|new|like  (default new)
//	keyword?  matches title/content/tags
type FeedQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Cat      string `form:"cat"`
	Type     string `form:"type"`
	Sort     string `form:"sort"`
	Keyword  string `form:"keyword"`
}

// normalize applies pagination defaults/clamps and lower-cases the discrete
// filters so comparisons in the repo are stable.
func (q *FeedQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 12
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Type = strings.ToLower(strings.TrimSpace(q.Type))
	q.Sort = strings.ToLower(strings.TrimSpace(q.Sort))
	q.Cat = strings.TrimSpace(q.Cat)
	q.Keyword = strings.TrimSpace(q.Keyword)
}

// offset returns the SQL offset for the current page.
func (q *FeedQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// PageQuery is the shared pagination binding for comment / follow lists.
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize applies pagination defaults/clamps.
func (q *PageQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// offset returns the SQL offset for the current page.
func (q *PageQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// CommentCreateDTO is the body for POST /community/posts/:id/comments.
// parentId is optional (a reply to another comment); omit/"" for a top-level
// comment.
type CommentCreateDTO struct {
	Content  string `json:"content" binding:"required,max=2048"`
	ParentID string `json:"parentId" binding:"omitempty"`
}
