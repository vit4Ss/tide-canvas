package model

import (
	"tidecanvas/internal/pkg/idgen"
)

// CommunityPost backs the explore / community feed (/api/community).
type CommunityPost struct {
	BaseModel

	UserID    idgen.ID  `gorm:"column:user_id;index;not null" json:"userId"`
	ProjectID *idgen.ID `gorm:"column:project_id;index" json:"projectId"`
	Title     string    `gorm:"column:title;type:varchar(128)" json:"title"`
	Content   string    `gorm:"column:content;type:text" json:"content"`
	CoverURL  string    `gorm:"column:cover_url;type:varchar(512)" json:"coverUrl"`
	Tags      string    `gorm:"column:tags;type:varchar(512)" json:"tags"`

	LikeCount    int `gorm:"column:like_count;type:int;not null;default:0" json:"likeCount"`
	CommentCount int `gorm:"column:comment_count;type:int;not null;default:0" json:"commentCount"`
	ViewCount    int `gorm:"column:view_count;type:int;not null;default:0" json:"viewCount"`

	// TaskID 是产出这条作品的生成任务(ai_tasks.id)。生成成功后由 ai 服务自动
	// 登记，靠它判重(一次生成只登记一条)。0 = 非生成来源(演示种子等)。
	TaskID idgen.ID `gorm:"column:task_id;index;default:0" json:"taskId"`

	// Status: 0 未发布 / 1 已发布 / 2 已下架。用户生成的作品一律落 0，
	// 公开广场只查 1，所以未经后台发布不会外泄。
	//
	// 列默认值必须是 0：GORM 建记录时会跳过零值字段、让数据库默认值生效，
	// 默认写 1 的话「未发布」的作品会被直接发布出去（已踩过）。需要已发布的
	// 调用方（演示种子）自己显式赋值。
	Status int `gorm:"column:status;type:tinyint;not null;default:0" json:"status"`
}

// TableName overrides the default pluralization.
func (CommunityPost) TableName() string { return "community_post" }

// PostComment is a comment (optionally a reply) on a CommunityPost.
type PostComment struct {
	BaseModel

	PostID   idgen.ID  `gorm:"column:post_id;index;not null" json:"postId"`
	UserID   idgen.ID  `gorm:"column:user_id;index;not null" json:"userId"`
	ParentID *idgen.ID `gorm:"column:parent_id;index" json:"parentId"`
	Content  string    `gorm:"column:content;type:text;not null" json:"content"`
	// Status: 0 隐藏 / 1 正常.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (PostComment) TableName() string { return "post_comment" }

// PostLike records that a user liked a post (unique per user+post).
type PostLike struct {
	BaseModel

	PostID idgen.ID `gorm:"column:post_id;index:idx_post_user,unique;not null" json:"postId"`
	UserID idgen.ID `gorm:"column:user_id;index:idx_post_user,unique;not null" json:"userId"`
}

// TableName overrides the default pluralization.
func (PostLike) TableName() string { return "post_like" }

// PostBookmark records that a user bookmarked / 收藏 a post (unique per user+post).
type PostBookmark struct {
	BaseModel

	PostID idgen.ID `gorm:"column:post_id;index:idx_bm_post_user,unique;not null" json:"postId"`
	UserID idgen.ID `gorm:"column:user_id;index:idx_bm_post_user,unique;not null" json:"userId"`
}

// TableName overrides the default pluralization.
func (PostBookmark) TableName() string { return "post_bookmark" }

// UserFollow records a follow relationship (follower -> followee).
type UserFollow struct {
	BaseModel

	FollowerID idgen.ID `gorm:"column:follower_id;index:idx_follower_followee,unique;not null" json:"followerId"`
	FolloweeID idgen.ID `gorm:"column:followee_id;index:idx_follower_followee,unique;not null" json:"followeeId"`
}

// TableName overrides the default pluralization.
func (UserFollow) TableName() string { return "user_follow" }
