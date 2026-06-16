package model

import (
	"time"

	"github.com/shopspring/decimal"
)

// RechargeOrder 充值订单表 recharge_order。对外以 public_id；order_no 为对账业务单号。
type RechargeOrder struct {
	PublicModel
	OrderNo       string          `json:"orderNo" gorm:"column:order_no"`
	UserID        int64           `json:"-" gorm:"column:user_id"`
	Amount        decimal.Decimal `json:"amount" gorm:"column:amount"`
	PointsAmount  int             `json:"pointsAmount" gorm:"column:points_amount"`
	PaymentMethod string          `json:"paymentMethod" gorm:"column:payment_method"`
	PaymentNo     string          `json:"paymentNo" gorm:"column:payment_no"`
	Status        int             `json:"status" gorm:"column:status"`
	PaidTime      *time.Time      `json:"paidTime" gorm:"column:paid_time"`
}

// TableName 表名。
func (RechargeOrder) TableName() string { return "recharge_order" }
