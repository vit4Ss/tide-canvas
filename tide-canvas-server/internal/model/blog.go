package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// BlogCategory groups blog articles (/api/blog).
type BlogCategory struct {
	BaseModel

	Name      string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Slug      string `gorm:"column:slug;type:varchar(64);uniqueIndex" json:"slug"`
	SortOrder int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	// Status: 0 隐藏 / 1 显示.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (BlogCategory) TableName() string { return "blog_category" }

// BlogArticle is a published article.
type BlogArticle struct {
	BaseModel

	CategoryID *idgen.ID `gorm:"column:category_id;index" json:"categoryId"`
	AuthorID   idgen.ID  `gorm:"column:author_id;index" json:"authorId"`
	Title      string    `gorm:"column:title;type:varchar(255);not null" json:"title"`
	Slug       string    `gorm:"column:slug;type:varchar(255);uniqueIndex" json:"slug"`
	Summary    string    `gorm:"column:summary;type:varchar(512)" json:"summary"`
	Content    string    `gorm:"column:content;type:longtext" json:"content"`
	CoverURL   string    `gorm:"column:cover_url;type:varchar(512)" json:"coverUrl"`

	ViewCount int `gorm:"column:view_count;type:int;not null;default:0" json:"viewCount"`
	// Status: 0 草稿 / 1 已发布.
	Status      int        `gorm:"column:status;type:tinyint;not null;default:0" json:"status"`
	PublishTime *time.Time `gorm:"column:publish_time" json:"publishTime"`
}

// TableName overrides the default pluralization.
func (BlogArticle) TableName() string { return "blog_article" }
