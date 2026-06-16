package model

import "time"

// PointsTransaction 积分流水表 points_transaction（内部账务）。
type PointsTransaction struct {
	SoftDeleteModel
	UserID       int64  `json:"-" gorm:"column:user_id"`
	Amount       int    `json:"amount" gorm:"column:amount"`
	BalanceAfter int    `json:"balanceAfter" gorm:"column:balance_after"`
	Type         int    `json:"type" gorm:"column:type"`
	BizID        *int64 `json:"-" gorm:"column:biz_id"`
	Remark       string `json:"remark" gorm:"column:remark"`
}

// TableName 表名。
func (PointsTransaction) TableName() string { return "points_transaction" }

// CheckinRecord 签到记录表 checkin_record。
type CheckinRecord struct {
	SoftDeleteModel
	UserID        int64     `json:"-" gorm:"column:user_id"`
	CheckinDate   time.Time `json:"checkinDate" gorm:"column:checkin_date"`
	StreakDays    int       `json:"streakDays" gorm:"column:streak_days"`
	PointsAwarded int       `json:"pointsAwarded" gorm:"column:points_awarded"`
}

// TableName 表名。
func (CheckinRecord) TableName() string { return "checkin_record" }
