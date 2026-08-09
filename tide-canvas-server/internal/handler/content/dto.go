package content

import "strings"

// dto.go defines request payloads / query params for content endpoints. JSON &
// form tags are camelCase to match the frontend wire contract.

// NotificationQuery is the query for GET /api/notifications. isRead is optional
// (pointer-less here: -1 means "all", 0 unread, 1 read).
type NotificationQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Type     string `form:"type"`
	// IsRead filters by read state: nil => all, 0 => unread, 1 => read.
	IsRead *int `form:"isRead"`
	// ActiveOnly：只要未过期的（expire_time 为空或在未来）；紧急横幅用。
	ActiveOnly bool `form:"activeOnly"`
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
