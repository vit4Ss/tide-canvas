package market

import "strings"

// dto.go defines request payloads for market endpoints. JSON/form tags use
// camelCase to match the frontend wire contract.

// ListQuery is the query for GET /api/market/models (MarketModelQuery + PageQuery).
//
//   - base:    filter by base family (e.g. "SDXL", "Flux", "Kling", "ComfyUI").
//     The sentinel "全部" (all) is treated as no filter.
//   - typ:     filter by model type tag (e.g. 文生图 / 图生图 / 文生视频).
//   - sort:    one of runs | name | new (default new).
//   - keyword: fuzzy match over name / description / tags.
type ListQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Base     string `form:"base"`
	Type     string `form:"type"`
	Sort     string `form:"sort"`
	Keyword  string `form:"keyword"`
}

// normalize applies pagination defaults/clamps and trims string filters. The
// "全部" base sentinel is cleared so it acts as "no filter".
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
	q.Base = strings.TrimSpace(q.Base)
	if q.Base == "全部" || strings.EqualFold(q.Base, "all") {
		q.Base = ""
	}
	q.Type = strings.TrimSpace(q.Type)
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.Sort = strings.TrimSpace(strings.ToLower(q.Sort))
}

// offset returns the SQL offset for the current page.
func (q *ListQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
