package model

import (
	"time"

	"tidecanvas/internal/pkg/idgen"
)

// chatprovider.go holds the AI chat model supply chain, which is deliberately
// separate from market_model: those rows drive 创作台 generation and the older
// main-site chat entry, and mixing dozens of fetched text models into them
// would change what both of those show. Nothing here is read by generation.
//
// ChatProvider   一个第三方 OpenAI 兼容服务（如 OpenAI 官方、DeepSeek、某中转站）
// ChatEndpoint   该供应商的一组 base_url + api_key，可配多组互为备用
// ChatModel      通过该供应商开放给 AI 聊天的模型，带自己的 Token 单价

// A note on Enabled: these columns carry no GORM `default` tag on purpose.
// GORM omits a zero-valued field that has one, letting the database default
// win — so a provider or address the operator creates already switched off
// would be inserted as switched on, live, with its credentials. The handlers
// set the "new rows start enabled" default in Go instead.

type ChatProvider struct {
	BaseModel

	Name      string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Enabled   bool   `gorm:"column:enabled" json:"enabled"`
	SortOrder int    `gorm:"column:sort_order;default:0" json:"sortOrder"`
	Remark    string `gorm:"column:remark;type:varchar(512)" json:"remark"`
}

func (ChatProvider) TableName() string { return "chat_provider" }

// ChatEndpoint is one credentialed address for a provider. Several may exist;
// the gateway walks them by SortOrder and falls to the next one when a call
// cannot be started. APIKey is sealed (internal/pkg/chatupstream) and json:"-"
// so it can never ride out in a response by accident.
type ChatEndpoint struct {
	BaseModel

	ProviderID idgen.ID `gorm:"column:provider_id;index;not null" json:"providerId"`
	Label      string   `gorm:"column:label;type:varchar(64)" json:"label"`
	BaseURL    string   `gorm:"column:base_url;type:varchar(512);not null" json:"baseUrl"`
	APIKey     string   `gorm:"column:api_key;type:text" json:"-"`
	Enabled    bool     `gorm:"column:enabled" json:"enabled"`
	SortOrder  int      `gorm:"column:sort_order;default:0" json:"sortOrder"`

	// Observed health, for the admin list only — routing always retries every
	// enabled endpoint, so a stale failure can never take one out of service.
	LastFailedAt *time.Time `gorm:"column:last_failed_at" json:"lastFailedAt"`
	LastFailure  string     `gorm:"column:last_failure;type:varchar(256)" json:"lastFailure"`
	LastOkAt     *time.Time `gorm:"column:last_ok_at" json:"lastOkAt"`
}

func (ChatEndpoint) TableName() string { return "chat_endpoint" }

// ChatModel is one model offered to AI chat. ModelKey is what the upstream
// expects and what LobeHub sends back. Pricing carries the same tokenPricing
// object the billing code already understands; a model without it is not
// offered, because there would be no way to charge for it.
type ChatModel struct {
	BaseModel

	ProviderID idgen.ID `gorm:"column:provider_id;index;not null" json:"providerId"`
	ModelKey   string   `gorm:"column:model_key;type:varchar(128);index;not null" json:"modelKey"`
	Name       string   `gorm:"column:name;type:varchar(128)" json:"name"`
	Enabled    bool     `gorm:"column:enabled" json:"enabled"`
	SortOrder  int      `gorm:"column:sort_order;default:0" json:"sortOrder"`
	// Priority orders the rows that share one ModelKey across providers: the
	// lowest is the provider a call goes to first, the rest are tried in turn
	// when every address of the one before has failed. It is separate from
	// SortOrder, which is the model's place in the picker; making a provider
	// preferred for one model must not move that model around in the list.
	// The admin "设为首选" action renumbers a key's rows 0, 1, 2… so the
	// values stay small and the order stays readable.
	Priority int `gorm:"column:priority;not null;default:0" json:"priority"`
	// Pricing is the JSON object {"tokenPricing":{…}} — same dialect the market
	// models used, so tokenbilling.Parse reads both without a second parser.
	Pricing string `gorm:"column:pricing;type:text" json:"pricing"`
	// Vision lets the operator declare that this model accepts images, which is
	// what LobeHub needs to allow attachments.
	Vision bool `gorm:"column:vision" json:"vision"`

	DiscoveredAt *time.Time `gorm:"column:discovered_at" json:"discoveredAt"`
}

func (ChatModel) TableName() string { return "chat_model" }

// ChatModelOrder is the one ordering every reader of chat_model uses when rows
// share a ModelKey: the catalogue that shows a model, the router that picks
// who serves it, and the admin list that says which provider is preferred.
// They must agree, or the price a user was shown is not the price they pay.
const ChatModelOrder = "priority ASC, sort_order ASC, id ASC"
