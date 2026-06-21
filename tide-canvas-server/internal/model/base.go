package model

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// BaseModel is embedded by the extended-domain (skeleton) entities. It provides
// the snowflake primary key, audit timestamps and a soft-delete marker. The core
// FULL entities in model.go declare these fields inline (and were wired before
// this file existed); BaseModel keeps the newer entities consistent without
// touching those.
//
// The PK is assigned in BeforeCreate when left zero, so callers may pre-assign
// an ID or let GORM generate one on insert.
type BaseModel struct {
	ID         idgen.ID       `gorm:"column:id;primaryKey;autoIncrement:false" json:"id"`
	CreateTime time.Time      `gorm:"column:create_time;autoCreateTime" json:"createTime"`
	UpdateTime time.Time      `gorm:"column:update_time;autoUpdateTime" json:"updateTime"`
	Deleted    gorm.DeletedAt `gorm:"column:deleted;index" json:"-"`
}

// BeforeCreate assigns a snowflake ID when one has not been set explicitly.
func (b *BaseModel) BeforeCreate(_ *gorm.DB) error {
	if b.ID == 0 {
		b.ID = idgen.Next()
	}
	return nil
}
