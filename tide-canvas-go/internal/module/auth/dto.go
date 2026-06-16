// Package auth 认证模块：注册 / 登录 / 刷新 / 改密 / 当前用户（对齐旧 AuthService）。
package auth

import (
	"time"

	"github.com/shopspring/decimal"
)

// SendEmailCodeReq 发送邮箱验证码请求。
type SendEmailCodeReq struct {
	Email string `json:"email" binding:"required,email"`
}

// RegisterReq 注册请求（用户名必填且全站唯一）。
type RegisterReq struct {
	Username string `json:"username" binding:"required,min=3,max=64"`
	Email    string `json:"email" binding:"required,email"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required,min=6,max=32"`
	Nickname string `json:"nickname"`
	Phone    string `json:"phone"`
}

// LoginReq 登录请求（account = 用户名或邮箱）。
type LoginReq struct {
	Account  string `json:"account" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// RefreshReq 刷新令牌请求。
type RefreshReq struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

// UpdatePasswordReq 修改密码请求。
type UpdatePasswordReq struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required,min=6,max=32"`
}

// UpdateProfileReq 修改个人资料请求（昵称 / 手机号，均可选，非空才更新）。
type UpdateProfileReq struct {
	Nickname string `json:"nickname"`
	Phone    string `json:"phone"`
}

// UserVO 用户信息视图。对外以 public_id 作为 id，不暴露内部雪花关联ID（roleId/teamId）。
type UserVO struct {
	ID              string          `json:"id"`
	Username        string          `json:"username"`
	Email           string          `json:"email"`
	Phone           string          `json:"phone"`
	Nickname        string          `json:"nickname"`
	Avatar          string          `json:"avatar"`
	Role            int             `json:"role"`
	Status          int             `json:"status"`
	APIQuota        int             `json:"apiQuota"`
	Points          int             `json:"points"`
	IsAuthor        int             `json:"isAuthor"`
	StorageQuota    int64           `json:"storageQuota"`
	InTeam          bool            `json:"inTeam"`
	TeamPriceFactor decimal.Decimal `json:"teamPriceFactor"`
	CreateTime      time.Time       `json:"createTime"`
	LastLoginTime   *time.Time      `json:"lastLoginTime"`
}

// LoginVO 登录 / 刷新响应。
type LoginVO struct {
	AccessToken  string  `json:"accessToken"`
	RefreshToken string  `json:"refreshToken"`
	ExpiresIn    int64   `json:"expiresIn"`
	UserInfo     *UserVO `json:"userInfo"`
}
