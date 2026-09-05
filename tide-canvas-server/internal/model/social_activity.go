package model

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

const (
	SocialActivityAnalysis = "analysis"
	SocialActivityDownload = "download"

	SocialActivityProcessing  = "processing"
	SocialActivityReady       = "ready"
	SocialActivityDownloading = "downloading"
	SocialActivitySucceeded   = "succeeded"
	SocialActivityFailed      = "failed"
	SocialActivityExpired     = "expired"
)

// SocialActivityRecord is the durable audit trail for the two capabilities on
// /analysis. SourceURL is visible only to the owning user and authorized
// administrators; Relay credentials and temporary upstream tokens are never
// persisted here.
type SocialActivityRecord struct {
	ID              idgen.ID       `gorm:"column:id;primaryKey;autoIncrement:false" json:"id"`
	UserID          idgen.ID       `gorm:"column:user_id;not null;index;index:idx_social_activity_user_created,priority:1" json:"userId"`
	ActivityType    string         `gorm:"column:activity_type;size:16;not null;index;index:idx_social_activity_type_created,priority:1;index:idx_social_activity_expiry,priority:1" json:"type"`
	Kind            string         `gorm:"column:kind;size:16;index" json:"kind"`
	Platform        string         `gorm:"column:platform;size:32;index" json:"platform"`
	SourceURL       string         `gorm:"column:source_url;type:text" json:"sourceUrl"`
	Title           string         `gorm:"column:title;size:512" json:"title"`
	Status          string         `gorm:"column:status;size:24;not null;index;index:idx_social_activity_expiry,priority:2" json:"status"`
	Quality         string         `gorm:"column:quality;size:16" json:"quality"`
	DurationSeconds int            `gorm:"column:duration_seconds;not null;default:0" json:"durationSeconds"`
	Width           int            `gorm:"column:width;not null;default:0" json:"width"`
	Height          int            `gorm:"column:height;not null;default:0" json:"height"`
	EstimatedBytes  int64          `gorm:"column:estimated_bytes;not null;default:0" json:"estimatedBytes"`
	DownloadedBytes int64          `gorm:"column:downloaded_bytes;not null;default:0" json:"downloadedBytes"`
	AnalysisRunID   idgen.ID       `gorm:"column:analysis_run_id;not null;default:0;index" json:"analysisRunId,omitempty"`
	PointCost       int            `gorm:"column:point_cost;not null;default:0" json:"pointCost"`
	Refunded        bool           `gorm:"column:refunded;not null;default:false" json:"refunded"`
	ReportTaskID    idgen.ID       `gorm:"column:report_task_id;not null;default:0;index" json:"-"`
	RequestKey      *string        `gorm:"column:request_key;size:160;uniqueIndex" json:"-"`
	RequestHash     string         `gorm:"column:request_hash;size:64" json:"-"`
	SnapshotJSON    string         `gorm:"column:snapshot_json;type:longtext" json:"-"`
	ErrorMessage    string         `gorm:"column:error_message;type:text" json:"errorMessage"`
	ExpiresAt       *time.Time     `gorm:"column:expires_at;index;index:idx_social_activity_expiry,priority:3" json:"expiresAt,omitempty"`
	CompletedAt     *time.Time     `gorm:"column:completed_at;index" json:"completedAt,omitempty"`
	CreateTime      time.Time      `gorm:"column:create_time;autoCreateTime;index;index:idx_social_activity_user_created,priority:2;index:idx_social_activity_type_created,priority:2" json:"createTime"`
	UpdateTime      time.Time      `gorm:"column:update_time;autoUpdateTime" json:"updateTime"`
	Deleted         gorm.DeletedAt `gorm:"column:deleted;index" json:"-"`
}

func (SocialActivityRecord) TableName() string { return "social_activity_record" }

func (r *SocialActivityRecord) BeforeCreate(_ *gorm.DB) error {
	if r.ID == 0 {
		r.ID = idgen.Next()
	}
	return nil
}
