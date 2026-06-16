package model

// Team 团队表 team。对外以 public_id；invite_code 为加入邀请码。
type Team struct {
	PublicModel
	Name        string `json:"name" gorm:"column:name"`
	OwnerID     int64  `json:"-" gorm:"column:owner_id"`
	InviteCode  string `json:"inviteCode" gorm:"column:invite_code"`
	MemberCount int    `json:"memberCount" gorm:"column:member_count"`
}

// TableName 表名。
func (Team) TableName() string { return "team" }

// TeamMember 团队成员表 team_member（中间表）。
type TeamMember struct {
	SoftDeleteModel
	TeamID int64 `json:"-" gorm:"column:team_id"`
	UserID int64 `json:"-" gorm:"column:user_id"`
	Role   int   `json:"role" gorm:"column:role"`
}

// TableName 表名。
func (TeamMember) TableName() string { return "team_member" }
