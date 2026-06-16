// Package model 定义 GORM 数据模型与通用基类。
//
// 三个基类对应 DDL 中不同的字段组合（见 sql/schema.sql 与 docs/db-optimization.md）：
//
//   - BaseModel       : id + create_time + update_time            （日志/流水/中间表）
//   - SoftDeleteModel : 上者 + deleted(逻辑删除)                    （无对外ID的业务表）
//   - PublicModel     : 上者 + public_id(UUID v4 对外公开ID)        （对外业务实体）
//
// 主键 id 为雪花ID，由 BeforeCreate 钩子在写入前注入（对齐旧版 MyBatis-Plus 的 ASSIGN_ID）。
// 对外业务实体只暴露 public_id（json 标签为 "id"），真实主键 id 用 json:"-" 隐藏，防枚举/探测。
package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/plugin/soft_delete"

	"github.com/tidecanvas/tide-canvas-go/pkg/snowflake"
)

// BaseModel 适用于日志/流水/中间表：雪花主键 + 创建/更新时间，无逻辑删除。
type BaseModel struct {
	ID         int64     `json:"-" gorm:"column:id;primaryKey"`
	CreateTime time.Time `json:"createTime" gorm:"column:create_time;autoCreateTime"`
	UpdateTime time.Time `json:"updateTime" gorm:"column:update_time;autoUpdateTime"`
}

// BeforeCreate 在写入前注入雪花主键（仅当 id 未显式赋值时）。
func (b *BaseModel) BeforeCreate(*gorm.DB) error {
	if b.ID == 0 {
		b.ID = snowflake.NextID()
	}
	return nil
}

// SoftDeleteModel 适用于无对外ID的业务表：在 BaseModel 字段上增加逻辑删除（deleted 0/1）。
type SoftDeleteModel struct {
	ID         int64                 `json:"-" gorm:"column:id;primaryKey"`
	CreateTime time.Time             `json:"createTime" gorm:"column:create_time;autoCreateTime"`
	UpdateTime time.Time             `json:"updateTime" gorm:"column:update_time;autoUpdateTime"`
	Deleted    soft_delete.DeletedAt `json:"-" gorm:"column:deleted;softDelete:flag"`
}

// BeforeCreate 在写入前注入雪花主键。
func (m *SoftDeleteModel) BeforeCreate(*gorm.DB) error {
	if m.ID == 0 {
		m.ID = snowflake.NextID()
	}
	return nil
}

// PublicModel 适用于对外业务实体：雪花主键 + public_id(UUID v4) + 时间戳 + 逻辑删除。
type PublicModel struct {
	ID         int64                 `json:"-" gorm:"column:id;primaryKey"`
	PublicID   string                `json:"id" gorm:"column:public_id;type:char(36);uniqueIndex"`
	CreateTime time.Time             `json:"createTime" gorm:"column:create_time;autoCreateTime"`
	UpdateTime time.Time             `json:"updateTime" gorm:"column:update_time;autoUpdateTime"`
	Deleted    soft_delete.DeletedAt `json:"-" gorm:"column:deleted;softDelete:flag"`
}

// BeforeCreate 在写入前注入雪花主键，并为对外公开ID生成 UUID v4。
func (m *PublicModel) BeforeCreate(*gorm.DB) error {
	if m.ID == 0 {
		m.ID = snowflake.NextID()
	}
	if m.PublicID == "" {
		m.PublicID = uuid.NewString()
	}
	return nil
}

// 用法示例（后续阶段在本包补充各业务 model）：
//
//	// 对外业务实体（带 public_id）
//	type User struct {
//	    PublicModel
//	    Username string `json:"username" gorm:"column:username"`
//	    Email    string `json:"email"    gorm:"column:email"`
//	}
//	func (User) TableName() string { return "sys_user" }
//
//	// 无对外ID的业务表
//	type RedeemCode struct {
//	    SoftDeleteModel
//	    Code   string `json:"code"   gorm:"column:code"`
//	    Points int    `json:"points" gorm:"column:points"`
//	}
//	func (RedeemCode) TableName() string { return "redeem_code" }
//
//	// 日志/中间表（无逻辑删除）
//	type AccessLog struct {
//	    BaseModel
//	    Path string `json:"path" gorm:"column:path"`
//	}
//	func (AccessLog) TableName() string { return "access_log" }
