// Package style 提供风格库、收藏、最近使用和后台预设维护能力。
package style

import "time"

// PageQuery 是风格库分页查询基础参数。
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize 兜底分页边界，避免一次拉取过多数据。
func (q *PageQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 40
	}
	if q.PageSize > 120 {
		q.PageSize = 120
	}
}

// Offset 返回 SQL OFFSET。
func (q *PageQuery) Offset() int { return (q.PageNum - 1) * q.PageSize }

// PresetQuery 描述用户端和后台端共用的风格列表筛选条件。
type PresetQuery struct {
	PageQuery
	Source         string `form:"source"` // gallery/favorite/recent/mine
	Keyword        string `form:"keyword"`
	Category       string `form:"category"`
	ModelID        string `form:"modelId"`
	Status         *int   `form:"status"`
	CommercialOnly bool   `form:"commercialOnly"`
}

// PresetSaveDTO 是后台维护或用户自定义风格时提交的数据。
type PresetSaveDTO struct {
	Name         string            `json:"name"`
	ShortName    string            `json:"shortName"`
	Description  string            `json:"description"`
	Prompt       string            `json:"prompt"`
	CoverURL     string            `json:"coverUrl"`
	Category     string            `json:"category"`
	AuthorName   string            `json:"authorName"`
	ModelType    string            `json:"modelType"`
	ModelID      string            `json:"modelId"`
	ModelIDs     []string          `json:"modelIds"`
	ModelPrompts map[string]string `json:"modelPrompts"`
	Tags         []string          `json:"tags"`
	Commercial   *int              `json:"commercial"`
	PublicFlag   *int              `json:"publicFlag"`
	Official     *int              `json:"official"`
	Status       *int              `json:"status"`
	SortOrder    *int              `json:"sortOrder"`
}

// PresetVO 是前端风格广场与后台表格使用的展示结构。
type PresetVO struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	ShortName    string            `json:"shortName"`
	Description  string            `json:"description"`
	Prompt       string            `json:"prompt"`
	CoverURL     string            `json:"coverUrl"`
	Category     string            `json:"category"`
	AuthorName   string            `json:"authorName"`
	ModelType    string            `json:"modelType"`
	ModelID      string            `json:"modelId"`
	ModelIDs     []string          `json:"modelIds"`
	ModelPrompts map[string]string `json:"modelPrompts"`
	Tags         []string          `json:"tags"`
	Commercial   int               `json:"commercial"`
	PublicFlag   int               `json:"publicFlag"`
	Official     int               `json:"official"`
	Status       int               `json:"status"`
	SortOrder    int               `json:"sortOrder"`
	UsageCount   int64             `json:"usageCount"`
	Favorited    bool              `json:"favorited"`
	OwnerType    string            `json:"ownerType"`
	CreateTime   time.Time         `json:"createTime"`
	UpdateTime   time.Time         `json:"updateTime"`
}

// ToggleFavoriteVO 返回收藏切换后的最终状态。
type ToggleFavoriteVO struct {
	Favorited bool `json:"favorited"`
}
