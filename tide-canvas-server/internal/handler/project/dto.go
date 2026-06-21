package project

// dto.go defines request payloads for project endpoints. JSON tags mirror
// tide-canvas-web/src/types/canvas.ts so the camelCase wire contract matches.

// CreateDTO is the body for POST /api/projects (ProjectCreateDTO).
type CreateDTO struct {
	Name        string `json:"name" binding:"required,max=255"`
	Description string `json:"description" binding:"omitempty,max=1024"`
}

// UpdateDTO is the body for PUT /api/projects/:id (ProjectUpdateDTO). All fields
// are optional (pointer types) so absent fields are left unchanged. Status uses
// 0 draft / 1 published.
type UpdateDTO struct {
	Name        *string `json:"name" binding:"omitempty,max=255"`
	Description *string `json:"description" binding:"omitempty,max=1024"`
	Status      *int    `json:"status" binding:"omitempty,oneof=0 1"`
	IsPublic    *bool   `json:"isPublic"`
}

// CanvasSaveDTO is the body for PUT /api/projects/:id/canvas (CanvasSaveDTO).
type CanvasSaveDTO struct {
	CanvasData string `json:"canvasData" binding:"required"`
	Thumbnail  string `json:"thumbnail" binding:"omitempty,max=1048576"`
}

// ListQuery is the query for GET /api/projects (ProjectQuery + PageQuery).
type ListQuery struct {
	PageNum        int    `form:"pageNum"`
	PageSize       int    `form:"pageSize"`
	OrderBy        string `form:"orderBy"`
	OrderDirection string `form:"orderDirection"`
	Keyword        string `form:"keyword"`
	// Status is a pointer so "not provided" differs from status 0 (draft).
	Status *int `form:"status"`
}

// normalize applies defaults and clamps for pagination.
func (q *ListQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 12
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// offset returns the SQL offset for the current page.
func (q *ListQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
