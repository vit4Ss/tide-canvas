package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// Admin-only billing / growth entities: payment channels, point rules, marketing
// campaigns and coupons. These back the operations & finance admin screens.

// PayChannel is a configured payment channel (支付渠道).
type PayChannel struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	// Type: alipay / wechat / stripe / paypal ...
	Type string `gorm:"column:type;type:varchar(32);not null" json:"type"`
	// Rate is the per-transaction fee rate (e.g. 0.006 = 0.6%).
	Rate decimal.Decimal `gorm:"column:rate;type:decimal(6,4);not null;default:0" json:"rate"`
	// TodayAmount is the running total collected today (for the dashboard).
	TodayAmount decimal.Decimal `gorm:"column:today_amount;type:decimal(12,2);not null;default:0" json:"todayAmount"`
	Callback    string          `gorm:"column:callback;type:varchar(512)" json:"callback"`
	Enabled     bool            `gorm:"column:enabled;not null;default:true" json:"enabled"`
	SortOrder   int             `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
}

// TableName overrides the default pluralization.
func (PayChannel) TableName() string { return "pay_channel" }

// PointRule is a rule that grants or deducts points for a scene (积分规则).
type PointRule struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(64);not null" json:"name"`
	// Scene: checkin / invite / share / first_recharge ...
	Scene string `gorm:"column:scene;type:varchar(64);not null" json:"scene"`
	// Amount may be negative (deduction) or positive (grant).
	Amount int `gorm:"column:amount;type:int;not null;default:0" json:"amount"`
	// Trigger: once / daily / per_action ...
	Trigger string `gorm:"column:trigger;type:varchar(32)" json:"trigger"`
	Enabled bool   `gorm:"column:enabled;not null;default:true" json:"enabled"`
}

// TableName overrides the default pluralization.
func (PointRule) TableName() string { return "point_rule" }

// Campaign is a marketing campaign / promotion (营销活动).
type Campaign struct {
	BaseModel

	Name string `gorm:"column:name;type:varchar(128);not null" json:"name"`
	// Type: discount / gift / fullreduce / flashsale ...
	Type string `gorm:"column:type;type:varchar(32);not null" json:"type"`
	// Strength is the discount strength descriptor (e.g. "8折" / "满100减20").
	Strength  string    `gorm:"column:strength;type:varchar(64)" json:"strength"`
	StartTime time.Time `gorm:"column:start_time" json:"startTime"`
	EndTime   time.Time `gorm:"column:end_time" json:"endTime"`
	// Used counts redemptions so far; Limit is the cap (0 = unlimited).
	Used  int `gorm:"column:used;type:int;not null;default:0" json:"used"`
	Limit int `gorm:"column:limit_count;type:int;not null;default:0" json:"limit"`
	// Status: draft / active / paused / ended.
	Status string `gorm:"column:status;type:varchar(16);not null;default:'draft'" json:"status"`
	// Audience is a JSON descriptor of the targeted user segment.
	Audience string `gorm:"column:audience;type:json" json:"audience"`
	// Channels is a JSON array of distribution channel keys.
	Channels string `gorm:"column:channels;type:json" json:"channels"`
}

// TableName overrides the default pluralization.
func (Campaign) TableName() string { return "campaign" }

// Coupon is a redeemable coupon code (优惠券).
type Coupon struct {
	BaseModel

	Code string `gorm:"column:code;type:varchar(64);uniqueIndex;not null" json:"code"`
	// Type: amount / percent / points.
	Type string `gorm:"column:type;type:varchar(16);not null" json:"type"`
	// Value is the face value (currency amount, percent points, or points).
	Value     decimal.Decimal `gorm:"column:value;type:decimal(10,2);not null;default:0" json:"value"`
	StartTime time.Time       `gorm:"column:start_time" json:"startTime"`
	EndTime   time.Time       `gorm:"column:end_time" json:"endTime"`
	// Used counts redemptions so far; Limit is the cap (0 = unlimited).
	Used  int `gorm:"column:used;type:int;not null;default:0" json:"used"`
	Limit int `gorm:"column:limit_count;type:int;not null;default:0" json:"limit"`
	// Status: active / disabled / expired.
	Status string `gorm:"column:status;type:varchar(16);not null;default:'active'" json:"status"`
}

// TableName overrides the default pluralization.
func (Coupon) TableName() string { return "coupon" }
