package model

import (
	"github.com/shopspring/decimal"

	"tidecanvas/internal/pkg/idgen"
)

// ModelCategory groups market models on /models.
type ModelCategory struct {
	BaseModel

	Name      string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Slug      string `gorm:"column:slug;type:varchar(64);uniqueIndex" json:"slug"`
	Icon      string `gorm:"column:icon;type:varchar(512)" json:"icon"`
	SortOrder int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	// Status: 0 隐藏 / 1 显示.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (ModelCategory) TableName() string { return "model_category" }

// MarketModel is a model listed in the marketplace (/api/market). It may link to
// an underlying AiModel for actual inference.
type MarketModel struct {
	BaseModel

	CategoryID  *idgen.ID `gorm:"column:category_id;index" json:"categoryId"`
	AiModelID   *idgen.ID `gorm:"column:ai_model_id;index" json:"aiModelId"`
	AuthorID    idgen.ID  `gorm:"column:author_id;index" json:"authorId"`
	Name        string    `gorm:"column:name;type:varchar(128);not null" json:"name"`
	Description string    `gorm:"column:description;type:text" json:"description"`
	CoverURL    string    `gorm:"column:cover_url;type:varchar(512)" json:"coverUrl"`
	Tags        string    `gorm:"column:tags;type:varchar(512)" json:"tags"`

	Price     decimal.Decimal `gorm:"column:price;type:decimal(10,2);not null;default:0" json:"price"`
	UseCount  int             `gorm:"column:use_count;type:int;not null;default:0" json:"useCount"`
	LikeCount int             `gorm:"column:like_count;type:int;not null;default:0" json:"likeCount"`
	// Status: 0 待审核 / 1 已上架 / 2 已下架.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (MarketModel) TableName() string { return "market_model" }
