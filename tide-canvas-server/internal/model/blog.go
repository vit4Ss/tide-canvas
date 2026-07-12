package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// blog.go — 博客域实体。文章有两种来源（source）：
//   - self:     后台「博客管理」手写发布（Markdown 正文）
//   - telegram: 从公开 Telegram 频道的网页预览（t.me/s/<username>）同步导入，
//     图片转存到本站对象存储后正文引用本站 URL（tg CDN 不稳定且境内不可达）。
// 两种来源共用同一张表与同一套前台展示（/blog 列表 + 详情）。

// Blog post status values (与 community_post 的 0 草稿 / 1 发布口径一致).
const (
	BlogStatusDraft     = 0
	BlogStatusPublished = 1
)

// Blog post source keys.
const (
	BlogSourceSelf     = "self"
	BlogSourceTelegram = "telegram"
)

// BlogPost is one blog article, hand-written or synced from a Telegram channel.
type BlogPost struct {
	BaseModel
	// Source: self | telegram（见常量）。
	Source string `gorm:"column:source;type:varchar(16);not null;default:self;index" json:"source"`
	// ChannelID/TgMsgID identify the originating telegram message for synced
	// posts (0 for self posts). The composite index backs the sync dedup lookup;
	// it is deliberately NOT unique because every self post carries (0,0).
	ChannelID idgen.ID `gorm:"column:channel_id;index:idx_blog_channel_msg;default:0" json:"channelId"`
	TgMsgID   int64    `gorm:"column:tg_msg_id;index:idx_blog_channel_msg;default:0" json:"tgMsgId"`
	Title     string   `gorm:"column:title;type:varchar(255);not null" json:"title"`
	Summary   string   `gorm:"column:summary;type:varchar(512)" json:"summary"`
	CoverURL  string   `gorm:"column:cover_url;type:varchar(1024)" json:"coverUrl"`
	// Content is Markdown for both sources (telegram messages are converted on
	// import: 链接/粗斜体/换行保留，图片重写为本站转存 URL).
	Content   string `gorm:"column:content;type:longtext" json:"content"`
	Status    int    `gorm:"column:status;type:tinyint;not null;default:0" json:"status"` // 0 草稿, 1 已发布
	ViewCount int64  `gorm:"column:view_count;not null;default:0" json:"viewCount"`
	// PublishedAt drives the public list ordering. Nullable: a draft has none;
	// telegram posts carry the original message time.
	PublishedAt *time.Time `gorm:"column:published_at;index" json:"publishedAt"`
}

// TableName overrides the default pluralized table name.
func (BlogPost) TableName() string { return "blog_post" }

// BlogChannel is one configured public Telegram channel source.
type BlogChannel struct {
	BaseModel
	// Username is the public @handle（不含 @，如 HotSora）— t.me/s/<username>.
	Username string `gorm:"column:username;type:varchar(64);uniqueIndex;not null" json:"username"`
	// Title is the admin-facing display name (备注名；同步时若为空则回填频道名).
	Title   string `gorm:"column:title;type:varchar(128)" json:"title"`
	Enabled bool   `gorm:"column:enabled;not null;default:true" json:"enabled"`
	// LastMsgID is the newest telegram message id already imported; the next
	// sync only walks messages above it.
	LastMsgID  int64      `gorm:"column:last_msg_id;default:0" json:"lastMsgId"`
	LastSyncAt *time.Time `gorm:"column:last_sync_at" json:"lastSyncAt"`
	PostCount  int64      `gorm:"column:post_count;default:0" json:"postCount"`
}

// TableName overrides the default pluralized table name.
func (BlogChannel) TableName() string { return "blog_channel" }
