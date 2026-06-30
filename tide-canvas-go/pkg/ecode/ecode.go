// Package ecode 业务错误码，对齐旧后端 com.tidecanvas.common.ResultCode。
// Error 同时实现 error 接口，承担旧后端 BusinessException 的角色。
package ecode

import "fmt"

// Error 业务错误码（码 + 文案），可作为 error 抛出/传递。
type Error struct {
	code int
	msg  string
}

// New 构造一个错误码。
func New(code int, msg string) *Error { return &Error{code: code, msg: msg} }

// Code 返回业务码。
func (e *Error) Code() int { return e.code }

// Message 返回文案。
func (e *Error) Message() string { return e.msg }

// Error 实现 error 接口。
func (e *Error) Error() string { return fmt.Sprintf("[%d] %s", e.code, e.msg) }

// WithMessage 返回同码、自定义文案的副本（对齐 Result.failure(code, message)）。
func (e *Error) WithMessage(msg string) *Error { return &Error{code: e.code, msg: msg} }

// 通用
var (
	Success      = New(200, "操作成功")
	BadRequest   = New(400, "请求参数错误")
	Unauthorized = New(401, "未登录或Token已过期")
	Forbidden    = New(403, "无权限访问")
	NotFound     = New(404, "资源不存在")
	Conflict     = New(409, "资源已被其他操作更新")
	RateLimit    = New(429, "请求频率超限")
	ServerError  = New(500, "系统内部错误")
)

// 账号
var (
	UsernameExists       = New(1001, "用户名已存在")
	EmailExists          = New(1002, "邮箱已注册")
	PasswordIncorrect    = New(1003, "密码不正确")
	AccountDisabled      = New(1004, "账号已被禁用")
	AccountNotFound      = New(1005, "账号不存在")
	PasswordResetInvalid = New(1006, "重置链接无效或已过期")
)

// AI / 积分 / 博客 / 订单 / 兑换
var (
	AIQuotaInsufficient  = New(2001, "AI调用额度不足")
	ModelUnavailable     = New(2002, "模型不可用")
	HandlerNotFound      = New(2003, "Handler不存在")
	AITaskFailed         = New(2004, "AI任务执行失败")
	PointsInsufficient   = New(2010, "积分不足")
	AlreadyCheckedIn     = New(2011, "今日已签到")
	NotAuthor            = New(2012, "非签约作者，无法发布博客")
	BlogAlreadyPurchased = New(2013, "已购买该博客")
	OrderStatusError     = New(2014, "订单状态异常")
	PaymentDisabled      = New(2015, "在线支付未启用")
	PaymentConfigError   = New(2016, "支付配置不完整，请联系管理员")
	PaymentGatewayError  = New(2017, "支付网关请求失败，请稍后重试")
	RedeemCodeInvalid    = New(2020, "兑换码无效")
	RedeemCodeUsed       = New(2021, "兑换码已被使用")
	RedeemCodeExpired    = New(2022, "兑换码已过期")
	RedeemCodeDisabled   = New(2023, "兑换码已停用")
)

// 文件
var (
	FileTypeNotAllowed  = New(3001, "文件类型不允许")
	FileSizeExceeded    = New(3002, "文件大小超限")
	StorageInsufficient = New(3003, "存储空间不足")
)
