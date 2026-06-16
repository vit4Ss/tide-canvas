package model

// 通知类型（type 列，varchar）。
const (
	NotificationTypeFollow  = "follow"  // 关注
	NotificationTypeComment = "comment" // 评论
	NotificationTypeLike    = "like"    // 点赞
	NotificationTypeTip     = "tip"     // 博客打赏
)

// 通知目标类型（target_type 列，varchar；空串表示无具体目标，如关注通知）。
const (
	NotificationTargetPost = "post" // 社区帖子
	NotificationTargetBlog = "blog" // 博客
)

// SysNotification 站内通知表 sys_notification（中间/流水表，内部:无 public_id）。
//
// 用 BaseModel（雪花主键 + create_time/update_time，无逻辑删除）。
// receiver_id 为收通知者，actor_id 为触发者（actor==receiver 的通知在 service 层被跳过，不入库）。
// target_id 为触发动作所关联内容（帖子/博客）的内部雪花主键，0 表示无具体目标（如关注通知）；
// 对外展示时由 service 把 target_id 反解为对应内容的 public_id（targetPublicId），绝不暴露雪花主键。
type SysNotification struct {
	BaseModel
	// ReceiverID 收通知者用户ID（内部雪花主键）。
	ReceiverID int64 `json:"-" gorm:"column:receiver_id"`
	// ActorID 触发通知者用户ID（内部雪花主键）。
	ActorID int64 `json:"-" gorm:"column:actor_id"`
	// Type 通知类型（follow/comment/like）。
	Type string `json:"type" gorm:"column:type"`
	// TargetType 目标类型（post/blog，关注类为空串）。
	TargetType string `json:"targetType" gorm:"column:target_type"`
	// TargetID 目标内容内部主键（0 表示无目标）。
	TargetID int64 `json:"-" gorm:"column:target_id"`
	// Content 通知摘要文案（如「评论了你的帖子」）。
	Content string `json:"content" gorm:"column:content"`
	// IsRead 是否已读（0 未读 / 1 已读）。
	IsRead int `json:"isRead" gorm:"column:is_read"`
}

// TableName 表名。
func (SysNotification) TableName() string { return "sys_notification" }
