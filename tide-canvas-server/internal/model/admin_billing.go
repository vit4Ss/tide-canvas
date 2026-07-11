package model

import (
	"github.com/shopspring/decimal"
)

// Admin-only billing / growth entities: payment channels and point rules. These
// back the operations & finance admin screens.

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

// 积分规则（PointRule）模型已整链下线（2026-07-12 用户拍板：无任何业务
// 消费方——生成消耗按模型定价、赠送走 sys_config points.* 键，规则表纯摆设。
// 遗留的 point_rule 表不再由代码管理）。

// 营销活动（Campaign）模型已随营销管理整链下线（2026-07-10 用户拍板：活动
// 数据无任何业务消费方——不打折、不发券、不统计,纯台账无真实链路）。
// 优惠券（Coupon）模型已下线（2026-07-09 用户拍板：产品没有优惠券体系）。
