package email

import (
	"fmt"
	"mime"
	"net/mail"
	"net/smtp"
	"strings"

	"github.com/sirupsen/logrus"
)

// mailConfig SMTP 连接与发件人身份配置（来自 viper mail.*）。
//
// 对齐旧 spring.mail.*（连接）+ AppMailProperties（业务语义）：
//   - Enabled=false 或 Host 为空 → 邮件渠道降级开发模式（不真发，验证码打日志）。
//   - FromAddress 留空回退 Username（多数 SMTP 要求发件地址=登录账号）。
//   - ReplyTo 留空回退发件地址。
type mailConfig struct {
	Enabled     bool
	Host        string
	Port        int
	Username    string
	Password    string
	FromAddress string
	FromName    string
	ReplyTo     string
}

// from 计算实际发件地址：from_address 优先，留空回退登录账号。
func (c mailConfig) from() string {
	if strings.TrimSpace(c.FromAddress) != "" {
		return c.FromAddress
	}
	return c.Username
}

// smtpSender 基于标准库 net/smtp 的 SMTP 发送器。
type smtpSender struct {
	conf   mailConfig
	logger *logrus.Logger
}

func newSMTPSender(conf mailConfig, logger *logrus.Logger) *smtpSender {
	return &smtpSender{conf: conf, logger: logger}
}

// enabled SMTP 是否已启用并配置（对齐 mailProperties.isEnabled() && host 非空）。
// false 时由 service 走开发模式：验证码打日志，不真发。
func (s *smtpSender) enabled() bool {
	return s.conf.Enabled && strings.TrimSpace(s.conf.Host) != ""
}

// sendHTML 发送一封 HTML 邮件。未启用时打日志即返回（开发模式兜底，正常流程不会走到）。
func (s *smtpSender) sendHTML(to, subject, htmlBody string) error {
	if !s.enabled() {
		s.warnf("[mail] 未启用或未配置 SMTP，跳过发送: to=%s subject=%s", to, subject)
		return nil
	}

	from := s.conf.from()
	msg := buildMessage(from, s.conf.FromName, s.conf.ReplyTo, to, subject, htmlBody)

	addr := fmt.Sprintf("%s:%d", s.conf.Host, s.conf.Port)
	// PlainAuth：net/smtp 在服务器通告 STARTTLS 时自动协商 TLS（适配 Gmail 587）。
	// 仅在配置了账号密码时携带鉴权，便于本地无鉴权 SMTP（如 MailHog）联调。
	var auth smtp.Auth
	if strings.TrimSpace(s.conf.Username) != "" {
		auth = smtp.PlainAuth("", s.conf.Username, s.conf.Password, s.conf.Host)
	}
	if err := smtp.SendMail(addr, auth, from, []string{to}, msg); err != nil {
		return err
	}
	return nil
}

// buildMessage 组装符合 RFC 5322 的邮件报文（HTML 正文，UTF-8）。
// 中文等非 ASCII 的显示名/主题按 RFC 2047 编码，避免乱码。
func buildMessage(fromAddr, fromName, replyTo, to, subject, htmlBody string) []byte {
	var b strings.Builder
	// From：带显示名时用 mail.Address 自动按需编码显示名。
	if strings.TrimSpace(fromName) != "" {
		b.WriteString("From: " + (&mail.Address{Name: fromName, Address: fromAddr}).String() + "\r\n")
	} else {
		b.WriteString("From: " + fromAddr + "\r\n")
	}
	b.WriteString("To: " + to + "\r\n")
	if strings.TrimSpace(replyTo) != "" {
		b.WriteString("Reply-To: " + replyTo + "\r\n")
	}
	b.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(htmlBody)
	return []byte(b.String())
}

func (s *smtpSender) warnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}
