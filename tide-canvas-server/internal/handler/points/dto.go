package points

// dto.go defines request payloads for the points endpoints. JSON/form tags use
// camelCase to match the frontend wire contract.

// RecordQuery is the query for GET /api/points/records (PointRecordQuery +
// PageQuery). ChangeType, when non-empty, filters by record change type.
type RecordQuery struct {
	PageNum    int    `form:"pageNum"`
	PageSize   int    `form:"pageSize"`
	ChangeType string `form:"changeType"`
}

// normalize applies defaults and clamps for pagination.
func (q *RecordQuery) normalize() {
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
func (q *RecordQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
