// Package alerting implements the administrator-only incident notification
// center: encrypted destinations, rule routing, deduplication and a durable
// delivery outbox.
package alerting

import "time"

const (
	ChannelFeishu   = "feishu"
	ChannelDingTalk = "dingtalk"
	ChannelWeCom    = "wecom"
	ChannelTelegram = "telegram"

	SeverityInfo     = "info"
	SeverityWarning  = "warning"
	SeverityError    = "error"
	SeverityCritical = "critical"
)

type ChannelConfig struct {
	Webhook  string `json:"webhook,omitempty"`
	Secret   string `json:"secret,omitempty"`
	BotToken string `json:"botToken,omitempty"`
	ChatID   string `json:"chatId,omitempty"`
	ThreadID string `json:"threadId,omitempty"`
}

type ChannelInput struct {
	Name        string        `json:"name"`
	Type        string        `json:"type"`
	Enabled     bool          `json:"enabled"`
	MinSeverity string        `json:"minSeverity"`
	Config      ChannelConfig `json:"config"`
}

type ChannelView struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Type          string        `json:"type"`
	Enabled       bool          `json:"enabled"`
	MinSeverity   string        `json:"minSeverity"`
	Config        ChannelConfig `json:"config"`
	Configured    bool          `json:"configured"`
	LastSuccessAt string        `json:"lastSuccessAt"`
	LastFailureAt string        `json:"lastFailureAt"`
	LastError     string        `json:"lastError"`
	CreateTime    string        `json:"createTime"`
	UpdateTime    string        `json:"updateTime"`
}

type RuleInput struct {
	Name             string   `json:"name"`
	Enabled          bool     `json:"enabled"`
	EventPatterns    []string `json:"eventPatterns"`
	MinSeverity      string   `json:"minSeverity"`
	ChannelIDs       []string `json:"channelIds"`
	CooldownSeconds  int      `json:"cooldownSeconds"`
	AggregateSeconds int      `json:"aggregateSeconds"`
	SendRecovery     bool     `json:"sendRecovery"`
}

type RuleView struct {
	ID string `json:"id"`
	RuleInput
	CreateTime string `json:"createTime"`
	UpdateTime string `json:"updateTime"`
}

type EventInput struct {
	EventType   string
	Category    string
	Severity    string
	Fingerprint string
	Title       string
	Content     string
	Source      string
	Details     map[string]any
	OccurredAt  time.Time
}

type EventView struct {
	ID              string         `json:"id"`
	EventType       string         `json:"eventType"`
	Category        string         `json:"category"`
	Severity        string         `json:"severity"`
	State           string         `json:"state"`
	Fingerprint     string         `json:"fingerprint"`
	Title           string         `json:"title"`
	Content         string         `json:"content"`
	Details         map[string]any `json:"details"`
	Source          string         `json:"source"`
	Environment     string         `json:"environment"`
	InstanceID      string         `json:"instanceId"`
	OccurrenceCount int            `json:"occurrenceCount"`
	FirstOccurredAt string         `json:"firstOccurredAt"`
	LastOccurredAt  string         `json:"lastOccurredAt"`
	ResolvedAt      string         `json:"resolvedAt"`
	CreateTime      string         `json:"createTime"`
}

type DeliveryView struct {
	ID              string `json:"id"`
	EventID         string `json:"eventId"`
	ChannelID       string `json:"channelId"`
	ChannelName     string `json:"channelName"`
	ChannelType     string `json:"channelType"`
	Kind            string `json:"kind"`
	Status          string `json:"status"`
	AttemptCount    int    `json:"attemptCount"`
	HTTPStatus      int    `json:"httpStatus"`
	ResponseExcerpt string `json:"responseExcerpt"`
	ErrorMessage    string `json:"errorMessage"`
	NextAttemptAt   string `json:"nextAttemptAt"`
	SentAt          string `json:"sentAt"`
	CreateTime      string `json:"createTime"`
}

type EventQuery struct {
	PageNum  int
	PageSize int
	Keyword  string
	Severity string
	Category string
	State    string
}

type Page[T any] struct {
	Records  []T
	Total    int64
	PageNum  int
	PageSize int
}
