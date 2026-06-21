package model

import (
	"time"

	"github.com/shopspring/decimal"

	"tidecanvas/internal/pkg/idgen"
)

// PointRecord is a ledger entry for a user's point balance (/api/points).
type PointRecord struct {
	BaseModel

	UserID idgen.ID `gorm:"column:user_id;index;not null" json:"userId"`
	// ChangeType: e.g. recharge / consume / checkin / reward / refund.
	ChangeType string `gorm:"column:change_type;type:varchar(32);not null" json:"changeType"`
	// Amount may be negative (consumption) or positive (gain).
	Amount  int    `gorm:"column:amount;type:int;not null" json:"amount"`
	Balance int    `gorm:"column:balance;type:int;not null;default:0" json:"balance"`
	Remark  string `gorm:"column:remark;type:varchar(255)" json:"remark"`
	// RefID points at the originating entity (order / task), optional.
	RefID *idgen.ID `gorm:"column:ref_id;index" json:"refId"`
}

// TableName overrides the default pluralization.
func (PointRecord) TableName() string { return "point_record" }

// CheckinRecord records a daily check-in (unique per user+day for idempotency).
type CheckinRecord struct {
	BaseModel

	UserID idgen.ID `gorm:"column:user_id;index:idx_user_day,unique;not null" json:"userId"`
	// CheckinDate is the YYYY-MM-DD day key used for the unique constraint.
	CheckinDate string `gorm:"column:checkin_date;type:varchar(10);index:idx_user_day,unique;not null" json:"checkinDate"`
	Points      int    `gorm:"column:points;type:int;not null;default:0" json:"points"`
	// ContinuousDays is the running streak length.
	ContinuousDays int `gorm:"column:continuous_days;type:int;not null;default:1" json:"continuousDays"`
}

// TableName overrides the default pluralization.
func (CheckinRecord) TableName() string { return "checkin_record" }

// Plan is a subscription / membership tier shown on /pricing.
type Plan struct {
	BaseModel

	Name        string          `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Code        string          `gorm:"column:code;type:varchar(32);uniqueIndex" json:"code"`
	Description string          `gorm:"column:description;type:varchar(512)" json:"description"`
	Price       decimal.Decimal `gorm:"column:price;type:decimal(10,2);not null;default:0" json:"price"`
	// DurationDays is the entitlement length (0 = one-time / perpetual).
	DurationDays int    `gorm:"column:duration_days;type:int;not null;default:0" json:"durationDays"`
	PointsGrant  int    `gorm:"column:points_grant;type:int;not null;default:0" json:"pointsGrant"`
	Features     string `gorm:"column:features;type:json" json:"features"`
	SortOrder    int    `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	// Status: 0 下架 / 1 上架.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (Plan) TableName() string { return "plan" }

// PointPackage is a one-off point top-up bundle.
type PointPackage struct {
	BaseModel

	Name        string          `gorm:"column:name;type:varchar(64);not null" json:"name"`
	Points      int             `gorm:"column:points;type:int;not null;default:0" json:"points"`
	BonusPoints int             `gorm:"column:bonus_points;type:int;not null;default:0" json:"bonusPoints"`
	Price       decimal.Decimal `gorm:"column:price;type:decimal(10,2);not null;default:0" json:"price"`
	SortOrder   int             `gorm:"column:sort_order;type:int;not null;default:0" json:"sortOrder"`
	// Status: 0 下架 / 1 上架.
	Status int `gorm:"column:status;type:tinyint;not null;default:1" json:"status"`
}

// TableName overrides the default pluralization.
func (PointPackage) TableName() string { return "point_package" }

// Order is a purchase record (/api/orders + /api/billing payment callbacks).
type Order struct {
	BaseModel

	OrderNo string   `gorm:"column:order_no;type:varchar(64);uniqueIndex;not null" json:"orderNo"`
	UserID  idgen.ID `gorm:"column:user_id;index;not null" json:"userId"`
	// OrderType: plan / point_package.
	OrderType string    `gorm:"column:order_type;type:varchar(32);not null" json:"orderType"`
	PlanID    *idgen.ID `gorm:"column:plan_id;index" json:"planId"`
	PackageID *idgen.ID `gorm:"column:package_id;index" json:"packageId"`

	Amount        decimal.Decimal `gorm:"column:amount;type:decimal(10,2);not null;default:0" json:"amount"`
	PayMethod     string          `gorm:"column:pay_method;type:varchar(32)" json:"payMethod"`
	TransactionID string          `gorm:"column:transaction_id;type:varchar(128)" json:"transactionId"`

	// Status: 0 待支付 / 1 已支付 / 2 已取消 / 3 已退款.
	Status  int        `gorm:"column:status;type:tinyint;not null;default:0" json:"status"`
	PayTime *time.Time `gorm:"column:pay_time" json:"payTime"`
}

// TableName overrides the default pluralization.
func (Order) TableName() string { return "order" }
