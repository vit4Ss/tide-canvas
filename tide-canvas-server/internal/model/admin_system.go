package model

import (
	"time"
)

// Admin-only system / platform entities: logs, config, email templates and
// API keys. These back the system & developer admin screens.
// (资源管理/AdminResource 已于 2026-07-09 整链删除——纯种子演示数据，无真实探测。)

// SysLog is a system / operation log entry (系统日志).
type SysLog struct {
	BaseModel

	// Level: debug / info / warn / error.
	Level   string `gorm:"column:level;type:varchar(16);not null;default:'info';index" json:"level"`
	Module  string `gorm:"column:module;type:varchar(64);index" json:"module"`
	Message string `gorm:"column:message;type:text" json:"message"`
	IP      string `gorm:"column:ip;type:varchar(64)" json:"ip"`
	// Operator is the username / id of who triggered the logged action.
	Operator   string    `gorm:"column:operator;type:varchar(64)" json:"operator"`
	CreateTime time.Time `gorm:"column:create_time;autoCreateTime" json:"createTime"`
}

// TableName overrides the default pluralization.
func (SysLog) TableName() string { return "sys_log" }

// ConfigKeyFooterLinks is the sys_config key holding the site footer link
// columns as JSON: [{title, links:[{label, href}]}]. Edited in the admin
// 配置管理 screen; served to the site by GET /api/site/footer.
const ConfigKeyFooterLinks = "site.footerLinks"

// DefaultFooterLinksJSON is the footer's factory default (mirrors the original
// hard-coded site-footer columns). Used to seed the config key and as the
// serve-time fallback when the stored value is missing or unparseable.
const DefaultFooterLinksJSON = `[
  {"title":"产品","links":[
    {"label":"图片生成","href":"/studio?type=image"},
    {"label":"视频创作","href":"/studio?type=video"},
    {"label":"作品广场","href":"/explore"}]},
  {"title":"社区","links":[
    {"label":"作品广场","href":"/explore"},
    {"label":"创作者","href":"/#creators"},
    {"label":"玩法教程","href":"/inspire"},
    {"label":"灵感周报","href":"/inspire"}]},
  {"title":"关于","links":[
    {"label":"价格方案","href":"/pricing"},
    {"label":"企业版","href":"/pricing"},
    {"label":"服务条款","href":"/terms"},
    {"label":"隐私政策","href":"/privacy"}]}
]`

// ConfigKeyHomeGlobal is the sys_config key holding the homepage's global
// settings as JSON: 背景流光 (preset / intensity / user-switch) + 首屏 CTA
// (label / target). Edited in the admin 首页楼层「楼层全局配置」panel; served
// to the site by GET /api/site/home-config.
const ConfigKeyHomeGlobal = "home.global"

// DefaultHomeGlobalJSON is the homepage global settings' factory default.
// 流光背景出厂即「关闭」（fluxPreset=off）——用户定稿的纯黑主题不带背景，
// 新库种子后不再需要到后台手关；后台「首页楼层」仍可随时开启。Used to
// seed the config key and as the serve-time fallback when the stored value is
// missing or unparseable.
const DefaultHomeGlobalJSON = `{"fluxPreset":"off","fluxIntensity":0.78,"fluxUserSwitch":true,"ctaLabel":"生成","ctaTarget":"studio"}`

// ConfigKeyPricingCompare is the sys_config key holding the pricing page's
// 方案对比 table rows as JSON: {rows:[{label, values:{<planID>: cell}}]}.
// Columns are NOT stored — the public page derives them from the live plan
// catalog, so plan renames / reorders / featured 标记 follow 套餐管理
// automatically. Edited in the admin 价格管理 screen; served to the site by
// GET /api/billing/compare. Cell convention: "✓" 支持 / "—" 不支持 / 任意文字.
const ConfigKeyPricingCompare = "pricing.compare"

// ConfigKeyPricingFaq is the sys_config key holding the pricing page's FAQ as
// JSON: {items:[{q, a}]}. Edited in the admin 价格管理 screen; served to the
// site by GET /api/billing/faq (factory default when never saved).
const ConfigKeyPricingFaq = "pricing.faq"

// ConfigKeyChatContextTokenLimit is the sys_config key overriding the chat
// conversation's cumulative context-token cap (llm.contextTokenLimit). Seeded
// on boot from the config file; edited in the admin 配置管理 screen and read
// per request by handler/chat, so changes apply WITHOUT a restart.
const ConfigKeyChatContextTokenLimit = "llm.contextTokenLimit"

// ConfigKeyChatCompressAt is the sys_config key for the chat context
// auto-compaction threshold in estimated tokens: once a conversation's
// context passes it, older history is rolled into the conversation summary
// (handler/chat maybeCompact). 0 = 自动（上限的 70%）. Seeded on boot; read
// per send so admin edits apply without a restart.
const ConfigKeyChatCompressAt = "llm.compressAtTokens"

// SysConfig is a key-value platform configuration entry (系统配置).
type SysConfig struct {
	BaseModel

	ConfigKey   string `gorm:"column:config_key;type:varchar(128);uniqueIndex;not null" json:"configKey"`
	ConfigValue string `gorm:"column:config_value;type:text" json:"configValue"`
	// Group buckets related config keys (e.g. site / mail / pay / ai).
	Group       string `gorm:"column:config_group;type:varchar(64);index" json:"group"`
	Description string `gorm:"column:description;type:varchar(255)" json:"description"`
}

// TableName overrides the default pluralization.
func (SysConfig) TableName() string { return "sys_config" }

// EmailTemplate is a reusable transactional email template (邮件模板).
type EmailTemplate struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Type: html / text.
	Type string `gorm:"column:type;type:varchar(16);not null;default:'html'" json:"type"`
	// Scene: register / reset_password / order_paid / notify ...
	Scene string `gorm:"column:scene;type:varchar(64);index" json:"scene"`
	// Variables is a free-text list of placeholder names usable in the body (e.g. {code} {name}).
	Variables string `gorm:"column:variables;type:varchar(255)" json:"variables"`
	Subject   string `gorm:"column:subject;type:varchar(255)" json:"subject"`
	Body      string `gorm:"column:body;type:text" json:"body"`
	Enabled   bool   `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (EmailTemplate) TableName() string { return "email_template" }

// ApiKey is a developer / integration API credential (API 密钥).
type ApiKey struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Scope is a free-text permission scope label granted to the key (e.g. 全部 / 只读).
	Scope    string `gorm:"column:scope;type:varchar(64)" json:"scope"`
	KeyValue string `gorm:"column:key_value;type:varchar(255);uniqueIndex;not null" json:"keyValue"`
	// DailyLimit caps requests per day (0 = unlimited).
	DailyLimit int `gorm:"column:daily_limit;type:int;not null;default:0" json:"dailyLimit"`
	// Expiry is when the key stops working (zero = no expiry).
	Expiry  time.Time `gorm:"column:expiry" json:"expiry"`
	Enabled bool      `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (ApiKey) TableName() string { return "api_key" }
