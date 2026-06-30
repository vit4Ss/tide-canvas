// Package redeem 兑换码模块：用户兑换发放积分 + 管理端批量生成 / 列表 / 启停 / 删除
// （对齐旧 RedeemService、RedeemController、AdminRedeemController）。
//
// 兑换码以 code 本身作为对外凭证（redeem_code 无 public_id）；管理端按主键(int64)操作。
// 状态机：0 未使用 / 1 已使用 / 2 已停用。兑换在 db.Transaction 内对该码行加锁，防并发重复兑换。
//
// 本模块依赖 points 模块发放积分：通过本包内定义的 PointsService 接口由 router 注入 points.Service，
// 不直接耦合 points 的具体实现。
package redeem

import "time"

// 兑换码状态（对齐 RedeemCodeDO.status 注释）。
const (
	StatusUnused   = 0 // 未使用
	StatusUsed     = 1 // 已使用
	StatusDisabled = 2 // 已停用
)

// 兑换码生成参数（对齐 RedeemServiceImpl 常量）。
const (
	// codeChars 去掉易混字符 I/L/O/0/1（对齐 CHARS）。
	codeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	// codeLen 兑换码长度（对齐 CODE_LEN）。
	codeLen = 12
	// maxGenerateCount 单次最多生成数量（对齐 generate 的 Math.min(..,1000)）。
	maxGenerateCount = 1000
	// uniqueRetry 唯一码生成最大重试次数（对齐 uniqueCode 的 6 次）。
	uniqueRetry = 6
)

// expireTimeLayout 有效期格式 yyyy-MM-dd HH:mm:ss（对齐 GenerateRedeemDTO 的 @JsonFormat）。
const expireTimeLayout = "2006-01-02 15:04:05"

// RedeemReq 用户兑换请求（对齐 RedeemDTO）。
type RedeemReq struct {
	Code string `json:"code" binding:"required"` // 兑换码不能为空
}

// GenerateRedeemReq 管理端批量生成兑换码请求（对齐 GenerateRedeemDTO）。
//
// ExpireTime 留空=永久有效，格式 yyyy-MM-dd HH:mm:ss（与旧 @JsonFormat 一致，用字符串接收后解析）。
// count / points 的非空与范围校验在 service 内完成（对齐旧 @NotNull/@Min/@Max）。
type GenerateRedeemReq struct {
	Count      *int   `json:"count"`
	Points     *int   `json:"points"`
	ExpireTime string `json:"expireTime"`
	Remark     string `json:"remark"`
}

// UpdateStatusReq 启用/停用请求（对齐 AdminRedeemController.updateStatus 的 body）。
type UpdateStatusReq struct {
	Status *int `json:"status"`
}

// RedeemCodeQuery 兑换码分页查询（对齐 RedeemCodeQuery extends PageQuery）。
type RedeemCodeQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Code     string `form:"code"`
	Status   *int   `form:"status"` // 0未使用 / 1已使用 / 2已停用
	BatchNo  string `form:"batchNo"`
}

// normalize 校正分页参数，对齐旧 PageQuery 默认值与边界（pageNum>=1，1<=pageSize<=100，默认20）。
func (q *RedeemCodeQuery) normalize() {
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

// RedeemResultVO 兑换结果（对齐 RedeemResultVO）。Balance 可空（余额查询失败时）。
type RedeemResultVO struct {
	Points  int  `json:"points"`  // 本次兑换获得的积分
	Balance *int `json:"balance"` // 兑换后的积分余额
}

// RedeemCodeVO 兑换码（管理端列表展示，对齐 RedeemCodeVO）。
type RedeemCodeVO struct {
	ID          int64      `json:"id,string"`
	Code        string     `json:"code"`
	Points      int        `json:"points"`
	CreatedBy   *int64     `json:"-"`
	CreatorName string     `json:"creatorName"`
	Status      int        `json:"status"`
	UsedBy      *int64     `json:"-"`
	UserName    string     `json:"userName"`
	UsedTime    *time.Time `json:"usedTime"`
	ExpireTime  *time.Time `json:"expireTime"`
	BatchNo     string     `json:"batchNo"`
	Remark      string     `json:"remark"`
	CreateTime  time.Time  `json:"createTime"`
}
