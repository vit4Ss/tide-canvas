package model

import "gorm.io/datatypes"

// BlogPost 博客文章表 blog_post。
type BlogPost struct {
	PublicModel
	AuthorID       int64          `json:"-" gorm:"column:author_id"`
	Title          string         `json:"title" gorm:"column:title"`
	Content        string         `json:"content,omitempty" gorm:"column:content"`
	Summary        string         `json:"summary" gorm:"column:summary"`
	CoverImage     string         `json:"coverImage" gorm:"column:cover_image"`
	Category       string         `json:"category" gorm:"column:category"`
	Tags           datatypes.JSON `json:"tags" gorm:"column:tags"`
	PointsRequired int            `json:"pointsRequired" gorm:"column:points_required"`
	ViewCount      int            `json:"viewCount" gorm:"column:view_count"`
	LikeCount      int            `json:"likeCount" gorm:"column:like_count"`
	CommentCount   int            `json:"commentCount" gorm:"column:comment_count"`
	TipTotal       int            `json:"tipTotal" gorm:"column:tip_total"`
	Status         int            `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (BlogPost) TableName() string { return "blog_post" }

// BlogPurchase 博客购买记录表 blog_purchase（中间表，无逻辑删除）。
type BlogPurchase struct {
	BaseModel
	UserID     int64 `json:"-" gorm:"column:user_id"`
	BlogID     int64 `json:"-" gorm:"column:blog_id"`
	PointsPaid int   `json:"pointsPaid" gorm:"column:points_paid"`
}

// TableName 表名。
func (BlogPurchase) TableName() string { return "blog_purchase" }
