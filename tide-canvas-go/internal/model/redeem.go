package model

import "time"

// RedeemCode 兑换码表 redeem_code（code 即对外凭证，无 public_id）。
type RedeemCode struct {
	SoftDeleteModel
	Code       string     `json:"code" gorm:"column:code"`
	Points     int        `json:"points" gorm:"column:points"`
	CreatedBy  *int64     `json:"-" gorm:"column:created_by"`
	Status     int        `json:"status" gorm:"column:status"`
	UsedBy     *int64     `json:"-" gorm:"column:used_by"`
	UsedTime   *time.Time `json:"usedTime" gorm:"column:used_time"`
	ExpireTime *time.Time `json:"expireTime" gorm:"column:expire_time"`
	BatchNo    string     `json:"batchNo" gorm:"column:batch_no"`
	Remark     string     `json:"remark" gorm:"column:remark"`
}

// TableName 表名。
func (RedeemCode) TableName() string { return "redeem_code" }
