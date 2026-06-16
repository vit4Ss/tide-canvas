package model

// SysFollow 关注关系表 sys_follow（中间表，内部:无 public_id）。
// follower 关注 followee；唯一键 uk_follower_followee 保证同一关注关系至多一条。
// 用 BaseModel（雪花主键 + create_time/update_time，无逻辑删除）：取关直接物理删除，
// 不保留软删行（否则唯一键占位会导致无法再次关注）。
type SysFollow struct {
	BaseModel
	// FollowerID 关注者用户ID（内部雪花主键）。
	FollowerID int64 `json:"-" gorm:"column:follower_id"`
	// FolloweeID 被关注者用户ID（内部雪花主键）。
	FolloweeID int64 `json:"-" gorm:"column:followee_id"`
}

// TableName 表名。
func (SysFollow) TableName() string { return "sys_follow" }
