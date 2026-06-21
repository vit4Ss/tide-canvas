package auth

import (
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
	// TeamID is null when the user belongs to no team (frontend: teamId?: number|null).
	TeamID          *idgen.ID `json:"teamId"`
	InTeam          bool      `json:"inTeam"`
	TeamPriceFactor float64   `json:"teamPriceFactor"`
	CreateTime      string    `json:"createTime"`
	LastLoginTime   string    `json:"lastLoginTime"`
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

// toUserVO maps a persisted user to its public VO. teamPriceFactor is supplied
// by the caller (looked up from the user's team) and defaults to 1.
func toUserVO(u *model.User, teamPriceFactor float64) UserVO {
	if teamPriceFactor <= 0 {
		teamPriceFactor = 1
	}
	var teamID *idgen.ID
	inTeam := false
	if u.TeamID != 0 {
		t := u.TeamID
		teamID = &t
		inTeam = true
	}
	return UserVO{
		ID:                   u.ID,
		Username:             u.Username,
		Email:                u.Email,
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
		TeamID:               teamID,
		InTeam:               inTeam,
		TeamPriceFactor:      teamPriceFactor,
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
