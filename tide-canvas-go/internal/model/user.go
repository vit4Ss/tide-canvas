package model

import "time"

// SysUser 用户表 sys_user。对外暴露 public_id（基类 PublicID，JSON 名 id），隐藏雪花主键与敏感字段。
type SysUser struct {
	PublicModel
	Username      string     `json:"username" gorm:"column:username"`
	Email         string     `json:"email" gorm:"column:email"`
	Phone         string     `json:"phone" gorm:"column:phone"`
	Password      string     `json:"-" gorm:"column:password"`
	Nickname      string     `json:"nickname" gorm:"column:nickname"`
	Avatar        string     `json:"avatar" gorm:"column:avatar"`
	Role          int        `json:"role" gorm:"column:role"`
	RoleID        *int64     `json:"-" gorm:"column:role_id"`
	Status        int        `json:"status" gorm:"column:status"`
	APIQuota      int        `json:"-" gorm:"column:api_quota"`
	Points        int        `json:"points" gorm:"column:points"`
	IsAuthor      int        `json:"isAuthor" gorm:"column:is_author"`
	StorageQuota  int64      `json:"storageQuota" gorm:"column:storage_quota"`
	TeamID        *int64     `json:"teamId" gorm:"column:team_id"`
	LastLoginTime *time.Time `json:"lastLoginTime" gorm:"column:last_login_time"`
}

// TableName 表名。
func (SysUser) TableName() string { return "sys_user" }

// SysRole 管理角色表 sys_role（RBAC 粒度权限）。
type SysRole struct {
	SoftDeleteModel
	Name        string `json:"name" gorm:"column:name"`
	Code        string `json:"code" gorm:"column:code"`
	Permissions string `json:"permissions" gorm:"column:permissions"`
	Builtin     int    `json:"builtin" gorm:"column:builtin"`
	Remark      string `json:"remark" gorm:"column:remark"`
}

// TableName 表名。
func (SysRole) TableName() string { return "sys_role" }
