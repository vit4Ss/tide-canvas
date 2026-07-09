package model

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// StylePreset is a reusable image-style preset (风格预设) selectable in the canvas
// image node's 风格 picker. System presets (OwnerType="system") form the 风格广场;
// users can also save their own (OwnerType="user"). Wire shape mirrors
// tide-canvas-web/src/types/style.ts StylePresetVO (assembled in handler/style/vo).
type StylePreset struct {
	BaseModel

	Name        string `gorm:"column:name;size:128;not null" json:"name"`
	ShortName   string `gorm:"column:short_name;size:64" json:"shortName"`
	Description string `gorm:"column:description;size:512" json:"description"`
	Prompt      string `gorm:"column:prompt;type:text" json:"prompt"`
	CoverURL    string `gorm:"column:cover_url;size:512" json:"coverUrl"`
	Category    string `gorm:"column:category;size:64;index" json:"category"`
	AuthorName  string `gorm:"column:author_name;size:64" json:"authorName"`
	ModelType   string `gorm:"column:model_type;size:32" json:"modelType"`
	// ModelIDs / ModelPrompts / Tags are JSON text (array / object / array).
	ModelIDs     string `gorm:"column:model_ids;size:512" json:"modelIds"`
	ModelPrompts string `gorm:"column:model_prompts;type:text" json:"modelPrompts"`
	Tags         string `gorm:"column:tags;size:512" json:"tags"`
	Commercial   int    `gorm:"column:commercial;default:0" json:"commercial"`
	PublicFlag   int    `gorm:"column:public_flag;default:1" json:"publicFlag"`
	Official     int    `gorm:"column:official;default:0" json:"official"`
	Status       int    `gorm:"column:status;default:1" json:"status"`
	SortOrder    int    `gorm:"column:sort_order;default:0" json:"sortOrder"`
	UsageCount   int    `gorm:"column:usage_count;default:0" json:"usageCount"`
	// OwnerType: system / user. OwnerID is 0 for system presets.
	OwnerType string   `gorm:"column:owner_type;size:16;default:'system'" json:"ownerType"`
	OwnerID   idgen.ID `gorm:"column:owner_id;index" json:"-"`
}

// TableName overrides the default pluralization.
func (StylePreset) TableName() string { return "style_preset" }

// StyleFavorite records that a user favorited a style preset (unique per pair).
type StyleFavorite struct {
	ID         idgen.ID  `gorm:"column:id;primaryKey;autoIncrement:false"`
	UserID     idgen.ID  `gorm:"column:user_id;index:idx_style_fav,unique;not null"`
	StyleID    idgen.ID  `gorm:"column:style_id;index:idx_style_fav,unique;not null"`
	CreateTime time.Time `gorm:"column:create_time;autoCreateTime"`
}

// TableName overrides the default pluralization.
func (StyleFavorite) TableName() string { return "style_favorite" }

// BeforeCreate assigns a snowflake ID when unset.
func (f *StyleFavorite) BeforeCreate(_ *gorm.DB) error {
	if f.ID == 0 {
		f.ID = idgen.Next()
	}
	return nil
}

// StyleUsage records a user's most-recent use of a style preset (unique per pair;
// UpdateTime bumped on each use) — backs the 风格 picker's「最近使用」source.
type StyleUsage struct {
	ID         idgen.ID  `gorm:"column:id;primaryKey;autoIncrement:false"`
	UserID     idgen.ID  `gorm:"column:user_id;index:idx_style_use,unique;not null"`
	StyleID    idgen.ID  `gorm:"column:style_id;index:idx_style_use,unique;not null"`
	UpdateTime time.Time `gorm:"column:update_time;autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralization.
func (StyleUsage) TableName() string { return "style_usage" }

// BeforeCreate assigns a snowflake ID when unset.
func (u *StyleUsage) BeforeCreate(_ *gorm.DB) error {
	if u.ID == 0 {
		u.ID = idgen.Next()
	}
	return nil
}
