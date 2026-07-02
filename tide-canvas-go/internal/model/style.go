package model

import "gorm.io/datatypes"

// StylePreset stores reusable image style presets maintained by admins or users.
type StylePreset struct {
	PublicModel
	OwnerUserID  *int64         `json:"-" gorm:"column:owner_user_id"`
	Name         string         `json:"name" gorm:"column:name"`
	ShortName    string         `json:"shortName" gorm:"column:short_name"`
	Description  string         `json:"description" gorm:"column:description"`
	Prompt       string         `json:"prompt" gorm:"column:prompt"`
	CoverURL     string         `json:"coverUrl" gorm:"column:cover_url"`
	Category     string         `json:"category" gorm:"column:category"`
	AuthorName   string         `json:"authorName" gorm:"column:author_name"`
	ModelType    string         `json:"modelType" gorm:"column:model_type"`
	ModelID      string         `json:"modelId" gorm:"column:model_id"`
	ModelIDs     datatypes.JSON `json:"modelIds" gorm:"column:model_ids"`
	ModelPrompts datatypes.JSON `json:"modelPrompts" gorm:"column:model_prompts"`
	Tags         datatypes.JSON `json:"tags" gorm:"column:tags"`
	Commercial   int            `json:"commercial" gorm:"column:commercial"`
	PublicFlag   int            `json:"publicFlag" gorm:"column:public_flag"`
	Official     int            `json:"official" gorm:"column:official"`
	Status       int            `json:"status" gorm:"column:status"`
	SortOrder    int            `json:"sortOrder" gorm:"column:sort_order"`
	UsageCount   int64          `json:"usageCount" gorm:"column:usage_count"`
}

func (StylePreset) TableName() string { return "style_preset" }

// StyleFavorite records a user's saved style presets.
type StyleFavorite struct {
	BaseModel
	UserID  int64 `json:"-" gorm:"column:user_id"`
	StyleID int64 `json:"-" gorm:"column:style_id"`
}

func (StyleFavorite) TableName() string { return "style_favorite" }

// StyleUsage stores recent-use ordering for each user and style.
type StyleUsage struct {
	BaseModel
	UserID   int64 `json:"-" gorm:"column:user_id"`
	StyleID  int64 `json:"-" gorm:"column:style_id"`
	UseCount int   `json:"useCount" gorm:"column:use_count"`
}

func (StyleUsage) TableName() string { return "style_usage" }
