package model

// Content entities for the inspiration / home-curation sections. Curated in the
// admin console ("灵感合集", "提示词库", "首页楼层"); Collection + PromptLib are also
// exposed read-only to users via the public /api/inspiration/* endpoints
// (internal/handler/inspiration).

// Collection is a curated inspiration set (灵感合集). Type distinguishes a plain
// collection (合集) from a theme (主题) or a prompt pack (提示词).
type Collection struct {
	BaseModel

	Title string `gorm:"column:title;type:varchar(128);not null" json:"title"`
	// Type: 合集 / 主题 / 提示词.
	Type     string `gorm:"column:type;type:varchar(16);not null;default:'合集'" json:"type"`
	CoverURL string `gorm:"column:cover_url;type:varchar(512)" json:"coverUrl"`
	// LinkedWorks is the number of works associated with this collection.
	LinkedWorks int    `gorm:"column:linked_works;type:int;not null;default:0" json:"linkedWorks"`
	SortOrder   int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	Visible     bool   `gorm:"column:visible;not null;default:true" json:"visible"`
	Tags        string `gorm:"column:tags;type:json" json:"tags"`
	Description string `gorm:"column:description;type:varchar(512)" json:"description"`
}

// TableName overrides the default pluralization.
func (Collection) TableName() string { return "collection" }

// PromptLib is an entry in the reusable prompt library (提示词库).
type PromptLib struct {
	BaseModel

	Text string `gorm:"column:text;type:text;not null" json:"text"`
	Tags string `gorm:"column:tags;type:json" json:"tags"`
	// Adoptions counts how many times this prompt was adopted by users.
	Adoptions int    `gorm:"column:adoptions;type:int;not null;default:0" json:"adoptions"`
	CoverURL  string `gorm:"column:cover_url;type:varchar(512)" json:"coverUrl"`
}

// TableName overrides the default pluralization.
func (PromptLib) TableName() string { return "prompt_lib" }

// HomeFloor is a configurable home-page section / floor (首页楼层).
type HomeFloor struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Subtitle is an admin-facing description shown in the 后台 floor list; it is
	// not sent to the public site.
	Subtitle string `gorm:"column:subtitle;type:varchar(255)" json:"subtitle"`
	// Type is the machine key the public homepage matches its sections on:
	// 英雄区 / 能力展示 / 无限画布 / 作品流 / 模型跑马灯 / FAQ / 价格. 唯一索引保证
	// 每个区块只有一行(与 AiTool.Key 同款),ensureBaselineFloors 的 FirstOrCreate 幂等。
	Type string `gorm:"column:type;type:varchar(32);not null;uniqueIndex" json:"type"`
	// ContentSource applies to 作品流 only: a comma-separated list of work-source
	// keys ("hot" / "latest", 可组合). Empty for non-works floors. 解析见
	// content/service.go parseFloorSources / resolveFloorWorks.
	ContentSource string `gorm:"column:content_source;type:varchar(64)" json:"contentSource"`
	Count         int    `gorm:"column:count;type:int;not null;default:0" json:"count"`
	SortOrder     int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	Enabled       bool   `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (HomeFloor) TableName() string { return "home_floor" }
