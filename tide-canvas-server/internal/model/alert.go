package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// AlertChannel is one administrator notification destination. ConfigEncrypted
// stores the complete channel credential as an AES-GCM envelope; credentials
// are never exposed by the admin API after they have been saved.
type AlertChannel struct {
	BaseModel
	Name            string     `gorm:"size:128;not null" json:"name"`
	Type            string     `gorm:"size:16;not null;index" json:"type"`
	Enabled         bool       `gorm:"not null;default:true;index" json:"enabled"`
	MinSeverity     string     `gorm:"size:16;not null;default:warning" json:"minSeverity"`
	ConfigEncrypted string     `gorm:"type:text;not null" json:"-"`
	LastSuccessAt   *time.Time `json:"lastSuccessAt"`
	LastFailureAt   *time.Time `json:"lastFailureAt"`
	LastError       string     `gorm:"size:512" json:"lastError"`
}

func (AlertChannel) TableName() string { return "alert_channel" }

// AlertRule controls event matching, routing, noise suppression and recovery.
// EventPatterns and ChannelIDs are JSON arrays kept as text for MySQL version
// compatibility. An empty channel list means every enabled channel.
type AlertRule struct {
	BaseModel
	Name             string `gorm:"size:128;not null" json:"name"`
	Enabled          bool   `gorm:"not null;default:true;index" json:"enabled"`
	EventPatterns    string `gorm:"type:text;not null" json:"-"`
	MinSeverity      string `gorm:"size:16;not null;default:warning" json:"minSeverity"`
	ChannelIDs       string `gorm:"type:text;not null" json:"-"`
	CooldownSeconds  int    `gorm:"not null;default:300" json:"cooldownSeconds"`
	AggregateSeconds int    `gorm:"not null;default:0" json:"aggregateSeconds"`
	SendRecovery     bool   `gorm:"not null;default:true" json:"sendRecovery"`
}

func (AlertRule) TableName() string { return "alert_rule" }

// AlertEvent is the current incident plus its occurrence history. Repeated
// occurrences reuse the active fingerprint and create at most one delivery per
// cooldown interval.
type AlertEvent struct {
	BaseModel
	EventType       string     `gorm:"size:128;not null;index" json:"eventType"`
	Category        string     `gorm:"size:32;not null;index" json:"category"`
	Severity        string     `gorm:"size:16;not null;index" json:"severity"`
	State           string     `gorm:"size:16;not null;index" json:"state"`
	Fingerprint     string     `gorm:"size:191;not null;index" json:"fingerprint"`
	Title           string     `gorm:"size:255;not null" json:"title"`
	Content         string     `gorm:"type:text;not null" json:"content"`
	Payload         string     `gorm:"type:text;not null" json:"-"`
	Source          string     `gorm:"size:128" json:"source"`
	Environment     string     `gorm:"size:32" json:"environment"`
	InstanceID      string     `gorm:"size:128" json:"instanceId"`
	OccurrenceCount int        `gorm:"not null;default:1" json:"occurrenceCount"`
	NotifySequence  int        `gorm:"not null;default:1" json:"notifySequence"`
	FirstOccurredAt time.Time  `gorm:"not null;index" json:"firstOccurredAt"`
	LastOccurredAt  time.Time  `gorm:"not null;index" json:"lastOccurredAt"`
	NextNotifyAt    time.Time  `gorm:"not null;index" json:"nextNotifyAt"`
	ResolvedAt      *time.Time `json:"resolvedAt"`
}

func (AlertEvent) TableName() string { return "alert_event" }

// AlertDelivery is the durable outbox. Message is a snapshot so a recovery or
// later recurrence cannot mutate a queued notification.
type AlertDelivery struct {
	BaseModel
	EventID         idgen.ID   `gorm:"not null;index;uniqueIndex:idx_alert_delivery_once,priority:1" json:"eventId"`
	ChannelID       idgen.ID   `gorm:"not null;index;uniqueIndex:idx_alert_delivery_once,priority:2" json:"channelId"`
	Sequence        int        `gorm:"not null;uniqueIndex:idx_alert_delivery_once,priority:3" json:"sequence"`
	Kind            string     `gorm:"size:16;not null" json:"kind"`
	Message         string     `gorm:"type:text;not null" json:"message"`
	Status          string     `gorm:"size:16;not null;index" json:"status"`
	AttemptCount    int        `gorm:"not null;default:0" json:"attemptCount"`
	NextAttemptAt   time.Time  `gorm:"not null;index" json:"nextAttemptAt"`
	LockedBy        string     `gorm:"size:128" json:"-"`
	LockedAt        *time.Time `json:"-"`
	HTTPStatus      int        `json:"httpStatus"`
	ResponseExcerpt string     `gorm:"size:512" json:"responseExcerpt"`
	ErrorMessage    string     `gorm:"size:512" json:"errorMessage"`
	SentAt          *time.Time `json:"sentAt"`
}

func (AlertDelivery) TableName() string { return "alert_delivery" }
