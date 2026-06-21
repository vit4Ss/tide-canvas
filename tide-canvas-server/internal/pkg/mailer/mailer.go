// Package mailer sends transactional email over SMTP using gomail.v2. It holds
// the email configuration in package state (set via Init at startup) and exposes
// a generic Send plus a SendVerificationCode helper that renders a bilingual
// (中文 / English) verification-code message.
//
// STARTTLS (port 587, ssl=false) is handled automatically by gomail's dialer;
// implicit TLS (port 465, ssl=true) is enabled by setting d.SSL = true.
package mailer

import (
	"fmt"
	"html"
	"strings"
	"sync"

	gomail "gopkg.in/gomail.v2"

	"tidecanvas/internal/config"
)

var (
	mu  sync.RWMutex
	cfg config.EmailConfig
)

// Init stores the email configuration in package state. Safe to call once at
// startup. When cfg.Enabled is false, callers (the auth service) decide not to
// send; Init still records the config so Send works if invoked directly.
func Init(c config.EmailConfig) {
	mu.Lock()
	defer mu.Unlock()
	cfg = c
}

// current returns a copy of the stored config under a read lock.
func current() config.EmailConfig {
	mu.RLock()
	defer mu.RUnlock()
	return cfg
}

// Send delivers an HTML email to a single recipient. From is set to
// "FromName <FromAddress>" and Reply-To to ReplyTo (falling back to FromAddress).
// Returns an error when the SMTP send fails.
func Send(to, subject, htmlBody string) error {
	c := current()

	from := c.FromAddress
	if strings.TrimSpace(from) == "" {
		return fmt.Errorf("mailer: from address not configured")
	}

	m := gomail.NewMessage()
	if strings.TrimSpace(c.FromName) != "" {
		m.SetAddressHeader("From", from, c.FromName)
	} else {
		m.SetHeader("From", from)
	}
	m.SetHeader("To", to)

	replyTo := strings.TrimSpace(c.ReplyTo)
	if replyTo == "" {
		replyTo = from
	}
	m.SetHeader("Reply-To", replyTo)

	m.SetHeader("Subject", subject)
	m.SetBody("text/html", htmlBody)

	d := gomail.NewDialer(c.Host, c.Port, c.Username, c.Password)
	// Implicit TLS for port 465. For STARTTLS (587) gomail negotiates it
	// automatically, so no extra flag is required.
	if c.SSL {
		d.SSL = true
	}

	if err := d.DialAndSend(m); err != nil {
		return fmt.Errorf("mailer: send: %w", err)
	}
	return nil
}

// SendVerificationCode emails a verification code to the recipient. The subject
// and body are bilingual and the body shows the code plus the expiry window
// (derived from CodeTTLSeconds, rounded up to whole minutes, minimum 1).
func SendVerificationCode(to, code string) error {
	c := current()

	minutes := c.CodeTTLSeconds / 60
	if c.CodeTTLSeconds%60 != 0 {
		minutes++
	}
	if minutes < 1 {
		minutes = 1
	}

	brand := c.FromName
	if strings.TrimSpace(brand) == "" {
		brand = "ScarecrowToken"
	}

	subject := fmt.Sprintf("%s 验证码 / Your verification code", brand)
	body := verificationHTML(html.EscapeString(brand), html.EscapeString(code), minutes)
	return Send(to, subject, body)
}

// verificationHTML renders the bilingual verification email. brand and code are
// expected to be already HTML-escaped by the caller.
func verificationHTML(brand, code string, minutes int) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 40px 8px 40px;">
          <h1 style="margin:0;font-size:20px;color:#111827;">%s</h1>
        </td></tr>
        <tr><td style="padding:8px 40px 0 40px;">
          <p style="margin:0 0 4px 0;font-size:15px;color:#374151;">您好，您的验证码是：</p>
          <p style="margin:0 0 16px 0;font-size:13px;color:#6b7280;">Hello, your verification code is:</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 40px 16px 40px;">
          <div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:10px;color:#111827;background-color:#f3f4f6;border-radius:8px;padding:16px 28px;">%s</div>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;">
          <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;">验证码 %d 分钟内有效，请勿向任何人泄露。</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">This code is valid for %d minutes. Do not share it with anyone.</p>
        </td></tr>
        <tr><td style="padding:16px 40px 32px 40px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">如果这不是您本人的操作，请忽略此邮件。 / If you did not request this, please ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, brand, code, minutes, minutes)
}
