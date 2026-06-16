package model

import "gorm.io/datatypes"

// CommunityPost 社区帖子表 community_post（自研社区）。
type CommunityPost struct {
	PublicModel
	UserID       int64          `json:"-" gorm:"column:user_id"`
	Title        string         `json:"title" gorm:"column:title"`
	Content      string         `json:"content" gorm:"column:content"`
	Images       datatypes.JSON `json:"images" gorm:"column:images"`
	Category     string         `json:"category" gorm:"column:category"`
	Tags         datatypes.JSON `json:"tags" gorm:"column:tags"`
	ViewCount    int            `json:"viewCount" gorm:"column:view_count"`
	LikeCount    int            `json:"likeCount" gorm:"column:like_count"`
	CommentCount int            `json:"commentCount" gorm:"column:comment_count"`
	Status       int            `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (CommunityPost) TableName() string { return "community_post" }

// CommunityComment 社区评论表 community_comment（自研社区）。
type CommunityComment struct {
	PublicModel
	PostID    int64  `json:"-" gorm:"column:post_id"`
	UserID    int64  `json:"-" gorm:"column:user_id"`
	ParentID  *int64 `json:"-" gorm:"column:parent_id"`
	Content   string `json:"content" gorm:"column:content"`
	LikeCount int    `json:"likeCount" gorm:"column:like_count"`
	Status    int    `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (CommunityComment) TableName() string { return "community_comment" }

// 点赞目标类型。
const (
	LikeTargetPost    = 1 // 帖子
	LikeTargetComment = 2 // 评论
	LikeTargetBlog    = 3 // 博客
)

// CommunityLike 点赞记录表 community_like（通用：帖子/评论/博客，无逻辑删除）。
type CommunityLike struct {
	BaseModel
	UserID     int64 `json:"-" gorm:"column:user_id"`
	TargetType int   `json:"targetType" gorm:"column:target_type"`
	TargetID   int64 `json:"-" gorm:"column:target_id"`
}

// TableName 表名。
func (CommunityLike) TableName() string { return "community_like" }
