package model

import (
	"tidecanvas/internal/pkg/idgen"
	"time"
)

// UserIdentity binds an external subject to an existing account. It retains
// the binding after account deletion so a provider cannot resurrect that user.
type UserIdentity struct {
	ID         idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"-"`
	Provider   string    `gorm:"size:16;not null;uniqueIndex:idx_identity_subject,priority:1;uniqueIndex:idx_identity_user,priority:1" json:"-"`
	Subject    string    `gorm:"size:255;not null;uniqueIndex:idx_identity_subject,priority:2" json:"-"`
	UserID     idgen.ID  `gorm:"not null;index;uniqueIndex:idx_identity_user,priority:2" json:"-"`
	CreateTime time.Time `gorm:"autoCreateTime" json:"-"`
}

func (UserIdentity) TableName() string { return "user_identity" }
