package model

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

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

	// ModelKey is the upstream model identifier (the relay's model id, e.g.
	// "gpt-image-2"). It is the 模型ID field in the admin form and the key used to
	// route a generation request to the relay.
	ModelKey string `gorm:"column:model_key;type:varchar(128);index" json:"modelKey"`

	// Config holds the per-model generation settings configured via the admin GUI
	// form (modes / batch / qualities / resolutions / ratios / price matrix / icon
	// / provider / cost / est. seconds …) as a JSON object. The admin edits it
	// through form controls, never raw JSON; the relay sync pre-fills it from the
	// upstream params_schema. Empty for rows with no settings yet.
	Config string `gorm:"column:config;type:text" json:"config"`

	// Type is the media category that drives the admin 模型管理 category filter:
	// text | image | video | audio. Empty string for rows created before this
	// column existed; BackfillMarketModelType derives those from the legacy
	// "type:" pseudo-tag in Tags on startup.
	Type string `gorm:"column:type;type:varchar(16);not null;default:'';index" json:"type"`

	Price     decimal.Decimal `gorm:"column:price;type:decimal(10,2);not null;default:0" json:"price"`
	UseCount  int             `gorm:"column:use_count;type:int;not null;default:0" json:"useCount"`
	LikeCount int             `gorm:"column:like_count;type:int;not null;default:0" json:"likeCount"`
	// Status: 0 待审核 / 1 已上架 / 2 已下架.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (MarketModel) TableName() string { return "market_model" }

// MarketModelTypes are the recognized media categories for MarketModel.Type.
var MarketModelTypes = []string{"text", "image", "video", "audio"}

// BackfillMarketModelType assigns a media Type to legacy market_model rows that
// predate the column (Type == ""). It derives the bucket from the row's tags:
// anything mentioning 视频/video → video, 音频/audio → audio, otherwise image
// (workflows and 文生图/图生图 all produce images). Idempotent: it only touches
// rows whose Type is still empty, so it is safe to run on every startup.
func BackfillMarketModelType(db *gorm.DB) error {
	type rule struct {
		typ   string
		likes []string
	}
	rules := []rule{
		{"video", []string{"%视频%", "%video%"}},
		{"audio", []string{"%音频%", "%audio%"}},
	}
	for _, r := range rules {
		tx := db.Model(&MarketModel{}).Where("type = ?", "")
		clause := db.Session(&gorm.Session{NewDB: true})
		for i, like := range r.likes {
			if i == 0 {
				clause = clause.Where("tags LIKE ?", like)
			} else {
				clause = clause.Or("tags LIKE ?", like)
			}
		}
		if err := tx.Where(clause).Update("type", r.typ).Error; err != nil {
			return err
		}
	}
	// Everything still unset defaults to image.
	return db.Model(&MarketModel{}).Where("type = ?", "").Update("type", "image").Error
}
