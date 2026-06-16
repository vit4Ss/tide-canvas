// Package team 团队模块：创建 / 邀请码加入 / 退出 / 解散 / 移除成员 / 我的团队，
// 并对外提供 AI 计费加价系数与团队成员关系判定（对齐旧 TeamService）。
package team

import (
	"time"

	"github.com/shopspring/decimal"
)

// CreateReq 创建团队请求（对齐 TeamCreateDTO）。
type CreateReq struct {
	Name string `json:"name" binding:"required,max=64"`
}

// JoinReq 凭邀请码加入请求（对齐 TeamJoinDTO）。
type JoinReq struct {
	InviteCode string `json:"inviteCode" binding:"required"`
}

// TeamMemberVO 团队成员视图。
// 对外 userId 用用户 public_id（不暴露雪花主键，遵循对外ID规范）。
type TeamMemberVO struct {
	UserID   string     `json:"userId"`
	Username string     `json:"username"`
	Nickname string     `json:"nickname"`
	Avatar   string     `json:"avatar"`
	// Role 团队内角色：0 成员，1 管理员。
	Role     int        `json:"role"`
	IsOwner  bool       `json:"isOwner"`
	JoinTime time.Time  `json:"joinTime"`
}

// TeamVO 团队视图。对外 id 用团队 public_id；不暴露 ownerId 雪花主键，
// 是否管理员通过 iAmOwner / 成员 isOwner 表达。
type TeamVO struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	InviteCode  string          `json:"inviteCode"`
	MemberCount int             `json:"memberCount"`
	// PriceFactor 团队模式 AI 消耗加价系数（clamp ≥ 1）。
	PriceFactor decimal.Decimal `json:"priceFactor"`
	// IAmOwner 当前请求用户是否为该团队管理员。
	IAmOwner    bool            `json:"iAmOwner"`
	Members     []TeamMemberVO  `json:"members"`
	CreateTime  time.Time       `json:"createTime"`
}
