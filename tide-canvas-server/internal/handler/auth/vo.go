package auth

import (
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines the response payloads (VOs) for auth endpoints. JSON shapes
// mirror tide-canvas-web/src/types/user.ts. Every id / foreign-key field is an
// idgen.ID so it serializes as a string (JS-safe). Passwords are never exposed.

// UserVO is the public view of a user (tide-canvas-web UserVO).
type UserVO struct {
	ID                   idgen.ID `json:"id"`
	Username             string   `json:"username"`
	Email                string   `json:"email"`
	Phone                string   `json:"phone"`
	Nickname             string   `json:"nickname"`
	Avatar               string   `json:"avatar"`
	Role                 int      `json:"role"`
	VipLevel             int      `json:"vipLevel"`
	ConcurrencyUnlimited int      `json:"concurrencyUnlimited"`
	RoleID               idgen.ID `json:"roleId"`
	Status               int      `json:"status"`
	ApiQuota             int64    `json:"apiQuota"`
	Points               int64    `json:"points"`
	IsAuthor             int      `json:"isAuthor"`
	StorageQuota         int64    `json:"storageQuota"`
	// Menus are the front sidebar menu keys the user's role grants
	// (model.FrontMenuKeys 子集)；studio-rail 据此过滤展示（配置了才显示）。
	Menus []string `json:"menus"`
	// AdminPerms 是角色解析后的后台模块权限键(model.AdminModuleKeys 子集;
	// role=9 为全量)。前端 AdminGuard/侧栏据此放行与过滤;实际接口门禁在
	// middleware.AdminAccess/AdminPerm,此处仅为展示口径。
	AdminPerms    []string `json:"adminPerms"`
	CreateTime    string   `json:"createTime"`
	LastLoginTime string   `json:"lastLoginTime"`
}

// LoginVO is the response of POST /api/auth/login (tide-canvas-web LoginVO).
type LoginVO struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int64  `json:"expiresIn"`
	UserInfo     UserVO `json:"userInfo"`
}

// RefreshVO is the response of POST /api/auth/refresh. The frontend reads
// accessToken + refreshToken only, but we return the full shape for symmetry.
type RefreshVO struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int64  `json:"expiresIn"`
}

// toUserVO maps a persisted user to its public VO. menus is the role-resolved
// sidebar menu list (model.MenusForUser); adminPerms is the role-resolved后台
// 模块权限 (model.AdminPermsForUser)。
func toUserVO(u *model.User, menus []string, adminPerms []string) UserVO {
	// 本地账号(用户名注册)的占位邮箱不对外暴露:抹成空串,前台统一显示为未绑定
	email := u.Email
	if strings.HasSuffix(email, noEmailSuffix) {
		email = ""
	}
	return UserVO{
		ID:                   u.ID,
		Username:             u.Username,
		Email:                email,
		Phone:                u.Phone,
		Nickname:             u.Nickname,
		Avatar:               u.Avatar,
		Role:                 u.Role,
		VipLevel:             u.VipLevel,
		ConcurrencyUnlimited: u.ConcurrencyUnlimited,
		RoleID:               u.RoleID,
		Status:               u.Status,
		ApiQuota:             u.ApiQuota,
		Points:               u.Points,
		IsAuthor:             u.IsAuthor,
		StorageQuota:         u.StorageQuota,
		Menus:                menus,
		AdminPerms:           adminPerms,
		CreateTime:           formatTime(u.CreateTime),
		LastLoginTime:        formatTime(u.LastLoginTime),
	}
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
