package auth

import (
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"time"
)

// CodeVerifier 邮箱验证码服务（对齐旧 VerificationCodeService）。
// 真实实现（Redis + 邮件 + 冷却）将在 email/security 模块迁移后注入。
type CodeVerifier interface {
	SendEmailCode(email string) error
	VerifyEmailCode(email, code string) error
}

// PasswordResetMailer 发送密码重置邮件。由 email 模块实现，auth 只依赖抽象以避免循环依赖。
type PasswordResetMailer interface {
	SendPasswordReset(email, resetURL string, ttl time.Duration) error
}

// TeamPriceProvider 团队加价系数提供者（对齐 TeamService.getPriceFactor）。
// 真实实现将在 team 模块迁移后注入。
type TeamPriceProvider interface {
	GetPriceFactor(userID int64) decimal.Decimal
}

// DevCodeVerifier 开发模式验证码：发送仅打日志、校验恒通过。仅用于联调，切勿用于生产。
type DevCodeVerifier struct{ Logger *logrus.Logger }

// SendEmailCode 占位：打印日志。
func (d DevCodeVerifier) SendEmailCode(email string) error {
	if d.Logger != nil {
		d.Logger.Warnf("[DEV] 邮箱验证码发送占位: %s（真实实现待 email 模块迁移）", email)
	}
	return nil
}

// VerifyEmailCode 占位：恒通过。
func (d DevCodeVerifier) VerifyEmailCode(email, code string) error { return nil }

// DefaultTeamPrice 未接入团队模块时的默认加价系数（恒为 1）。
type DefaultTeamPrice struct{}

// GetPriceFactor 恒返回 1。
func (DefaultTeamPrice) GetPriceFactor(userID int64) decimal.Decimal { return decimal.NewFromInt(1) }
