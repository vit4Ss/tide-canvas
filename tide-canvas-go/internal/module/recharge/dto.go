// Package recharge 充值订单 + 易支付（V2 / SHA256withRSA）模块：
// 创建充值订单、发起在线支付（网关跳转参数 + 签名）、异步回调入账、查单补偿、订单列表/详情、取消、超时关闭
// （对齐旧 OrderService、PaymentService、EpayClient/EpayConfig、EpaySignUtil、OrderTimeoutTask）。
//
// 跨模块依赖：支付成功后的加积分能力由 router 注入 PointsService（见 deps.go）。
// 对外资源 id 一律用 public_id；order_no 保留为对账业务单号。
package recharge

import (
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// 时间格式（对齐旧 yyyy-MM-dd HH:mm:ss）。
const dateTimeLayout = "2006-01-02 15:04:05"

// 订单状态（对齐 OrderStatusEnum 的 code）。
const (
	StatusPending   = 0 // 待支付
	StatusPaid      = 1 // 已支付
	StatusCancelled = 2 // 已取消
	StatusRefunded  = 3 // 已退款
	StatusTimeout   = 4 // 已超时
)

// orderStatusDesc 订单状态描述（对齐 OrderStatusEnum.desc）。
var orderStatusDesc = map[int]string{
	StatusPending:   "待支付",
	StatusPaid:      "已支付",
	StatusCancelled: "已取消",
	StatusRefunded:  "已退款",
	StatusTimeout:   "已超时",
}

// orderStatusName 返回订单状态描述，未知返回 "未知"（对齐 toOrderVO 的 statusName 兜底）。
func orderStatusName(code int) string {
	if name, ok := orderStatusDesc[code]; ok {
		return name
	}
	return "未知"
}

// RechargeCreateReq 充值创建（对齐 RechargeCreateDTO）。
// amount：单笔 0.01~100000 元；paymentMethod：可空，最长 16。
type RechargeCreateReq struct {
	Amount        decimal.Decimal `json:"amount"`
	PaymentMethod string          `json:"paymentMethod"`
}

// PaymentInitiateReq 发起支付（对齐 PaymentInitiateDTO）。
// payType：alipay/wxpay，可空，空则用订单创建时的支付方式或交给网关收银台。
type PaymentInitiateReq struct {
	PayType string `json:"payType"`
}

// OrderQuery 用户订单查询条件（对齐 OrderQuery extends PageQuery）。时间格式 yyyy-MM-dd HH:mm:ss。
type OrderQuery struct {
	PageNum   int    `form:"pageNum"`
	PageSize  int    `form:"pageSize"`
	Status    *int   `form:"status"`
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// AdminOrderQuery 管理端订单查询条件（对齐 AdminOrderQuery extends PageQuery）。
type AdminOrderQuery struct {
	PageNum   int    `form:"pageNum"`
	PageSize  int    `form:"pageSize"`
	UserID    *int64 `form:"userId"`
	Status    *int   `form:"status"`
	OrderNo   string `form:"orderNo"`
	StartTime string `form:"startTime"`
	EndTime   string `form:"endTime"`
}

// normalize 校正分页参数，对齐旧 PageQuery 默认值与边界（pageNum>=1，1<=pageSize<=100，默认20）。
func (q *OrderQuery) normalize() { q.PageNum, q.PageSize = normalizePage(q.PageNum, q.PageSize) }

// normalize 校正分页参数。
func (q *AdminOrderQuery) normalize() { q.PageNum, q.PageSize = normalizePage(q.PageNum, q.PageSize) }

// normalizePage 统一分页边界（对齐 PageQuery）。
func normalizePage(pageNum, pageSize int) (int, int) {
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return pageNum, pageSize
}

// RechargeOrderVO 充值订单（对齐 RechargeOrderVO）。id = public_id（对外不暴露雪花主键）。
type RechargeOrderVO struct {
	ID            string          `json:"id"`
	OrderNo       string          `json:"orderNo"`
	Amount        decimal.Decimal `json:"amount"`
	PointsAmount  int             `json:"pointsAmount"`
	PaymentMethod string          `json:"paymentMethod"`
	PaymentNo     string          `json:"paymentNo"`
	Status        int             `json:"status"`
	StatusName    string          `json:"statusName"`
	PaidTime      *time.Time      `json:"paidTime"`
	CreateTime    time.Time       `json:"createTime"`
}

// PaymentInitiateVO 发起支付结果（对齐 PaymentInitiateVO）。
// 前端用 params 对 payUrl 做 form POST 跳转到网关收银台。
type PaymentInitiateVO struct {
	PayURL  string            `json:"payUrl"`
	Params  map[string]string `json:"params"`
	OrderNo string            `json:"orderNo"`
}

// RechargeConfigVO 充值配置（对齐 RechargeConfigVO）。
type RechargeConfigVO struct {
	Ratio            int      `json:"ratio"`
	OnlinePayEnabled bool     `json:"onlinePayEnabled"`
	PayTypes         []string `json:"payTypes"`
}

// parseDateTime 解析 yyyy-MM-dd HH:mm:ss；空串或格式错误返回 ok=false（对齐 StringUtils.hasText 守卫）。
func parseDateTime(s string) (time.Time, bool) {
	if strings.TrimSpace(s) == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(dateTimeLayout, s, time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
