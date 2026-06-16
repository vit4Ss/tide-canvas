// Package points 积分与签到模块：积分余额 / 流水分页 / 每日签到 / 签到日历
// （对齐旧 PointsService、CheckinService）。
//
// 本模块是兑换码 / 博客 / AI / 充值等模块的依赖：通过 Service 暴露 AddPoints / DeductPoints
// 等公开方法供 router 注入复用。积分变动与余额更新均在 db.Transaction 内完成，并对
// sys_user 行加锁，防止并发超扣。
package points

import "time"

// 积分交易类型（对齐旧 PointsTransactionTypeEnum 的 code）。
const (
	TxRecharge    = 1 // 充值
	TxCheckin     = 2 // 签到
	TxAIConsume   = 3 // AI消耗
	TxBlogView    = 4 // 查看博客
	TxTipOut      = 5 // 打赏支出
	TxTipIn       = 6 // 收到打赏
	TxAdminAdjust = 7 // 管理员调整
	TxAIRefund    = 8 // AI生成失败返还
	TxRedeem      = 9 // 兑换码兑换
)

// txTypeDesc 交易类型描述（对齐 PointsTransactionTypeEnum.desc）。
var txTypeDesc = map[int]string{
	TxRecharge:    "充值",
	TxCheckin:     "签到",
	TxAIConsume:   "AI消耗",
	TxBlogView:    "查看博客",
	TxTipOut:      "打赏支出",
	TxTipIn:       "收到打赏",
	TxAdminAdjust: "管理员调整",
	TxAIRefund:    "AI生成失败返还",
	TxRedeem:      "兑换码兑换",
}

// TxTypeName 返回交易类型描述，未知返回 "未知"（对齐 PointsTransactionVO.typeName）。
func TxTypeName(code int) string {
	if name, ok := txTypeDesc[code]; ok {
		return name
	}
	return "未知"
}

// TransactionQuery 积分交易记录查询条件（对齐 PointsTransactionQuery extends PageQuery）。
// 时间格式 yyyy-MM-dd HH:mm:ss；UserId 仅管理端查询使用。
type TransactionQuery struct {
	PageNum   int    `form:"pageNum"`
	PageSize  int    `form:"pageSize"`
	UserID    *int64 `form:"userId"`
	Type      *int   `form:"type"`
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// normalize 校正分页参数，对齐旧 PageQuery 默认值与边界（pageNum>=1，1<=pageSize<=100，默认20）。
func (q *TransactionQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// PointsBalanceVO 积分余额（对齐 PointsBalanceVO）。
type PointsBalanceVO struct {
	Points         int  `json:"points"`
	TodayCheckedIn bool `json:"todayCheckedIn"`
}

// PointsTransactionVO 积分交易记录（对齐 PointsTransactionVO）。
type PointsTransactionVO struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"userId"`
	Amount       int       `json:"amount"`
	BalanceAfter int       `json:"balanceAfter"`
	Type         int       `json:"type"`
	TypeName     string    `json:"typeName"`
	BizID        *int64    `json:"bizId"`
	Remark       string    `json:"remark"`
	CreateTime   time.Time `json:"createTime"`
}

// CheckinStatusVO 签到状态 / 签到结果（对齐 CheckinStatusVO）。
type CheckinStatusVO struct {
	CheckedInToday bool `json:"checkedInToday"`
	StreakDays     int  `json:"streakDays"`
	PointsAwarded  int  `json:"pointsAwarded"`
}

// CheckinCalendarVO 签到日历，dates 为 yyyy-MM-dd 字符串列表（对齐 CheckinCalendarVO）。
type CheckinCalendarVO struct {
	Dates []string `json:"dates"`
}
