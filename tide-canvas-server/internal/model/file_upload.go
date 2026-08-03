package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// FileUploadGrant is the server-side half of a direct-to-object-storage
// upload.  The browser only receives a signed PUT URL; registration remains
// bound to the user, key, expected size and media metadata recorded here.
// Keeping the grant durable also makes register idempotent after a lost HTTP
// response and prevents an arbitrary object in a user's prefix being adopted.
type FileUploadGrant struct {
	ID               idgen.ID   `gorm:"primaryKey;autoIncrement:false" json:"id"`
	OwnerID          idgen.ID   `gorm:"index:idx_file_upload_grant_owner_active,priority:1;not null" json:"ownerId"`
	StorageKey       string     `gorm:"size:512;uniqueIndex;not null" json:"storageKey"`
	StorageScope     string     `gorm:"size:80;not null;default:'';index" json:"-"`
	OriginalName     string     `gorm:"size:512;not null" json:"originalName"`
	ExpectedSize     int64      `gorm:"not null" json:"expectedSize"`
	FileType         string     `gorm:"size:32;not null" json:"fileType"`
	Category         string     `gorm:"size:32;not null" json:"category"`
	ContentType      string     `gorm:"size:128;not null" json:"contentType"`
	ExpiresAt        time.Time  `gorm:"index:idx_file_upload_grant_owner_active,priority:2;not null" json:"expiresAt"`
	ConsumedAt       *time.Time `gorm:"index" json:"consumedAt,omitempty"`
	RegisteredFileID idgen.ID   `gorm:"default:0;index" json:"registeredFileId"`
	CleanupClaimedAt *time.Time `gorm:"index:idx_file_upload_grant_cleanup,priority:1" json:"-"`
	CleanupWorkerID  string     `gorm:"size:64;index:idx_file_upload_grant_cleanup,priority:2" json:"-"`
	CreateTime       time.Time  `gorm:"autoCreateTime" json:"createTime"`
}

func (FileUploadGrant) TableName() string { return "file_upload_grants" }
